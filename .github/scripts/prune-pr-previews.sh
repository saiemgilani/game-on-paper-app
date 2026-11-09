#!/usr/bin/env bash
# Squash pr-previews to one parentless commit holding only the open PRs' latest evidence: each
# open PR's folder for its current head commit (pr<N>/<sha7>/, the one its evidence comment shows),
# or its whole folder when evidence hasn't run on that head yet.
#
# Everything happens through GitHub's Git Data API: each kept folder is reused as the tree
# object it already is, so no media is downloaded or uploaded (a blobless git push still
# lazily fetched gigabytes of blobs to build its pack). The REST API has no lease, so the ref
# is re-read just before it moves and the run is skipped if an evidence publish landed since.
# Old commits become unreachable: images pinned to them (closed PRs' evidence comments) stop
# loading once GitHub garbage-collects, which is also when the repository's size drops.
#
# Usage: REPO=owner/name [DRY_RUN=1] prune-pr-previews.sh   (gh must be authenticated)
set -euo pipefail
: "${REPO:?REPO=owner/name}"
old=$(gh api "repos/$REPO/git/ref/heads/pr-previews" -q .object.sha)
root=$(gh api "repos/$REPO/git/commits/$old" -q .tree.sha)
# "<number> <head sha7>" for every open PR
open=$(gh pr list --repo "$REPO" --state open --limit 1000 --json number,headRefOid -q '.[] | "\(.number) \(.headRefOid[0:7])"')
entries=$(gh api "repos/$REPO/git/trees/$root" -q '.tree[] | select(.type == "tree") | [.path, .sha] | @tsv' |
  while IFS=$'\t' read -r path sha; do
    head=$(awk -v n="${path#pr}" '$1 == n {print $2}' <<<"$open")
    [ -n "$head" ] || continue
    # the head's folder alone when it exists (older pushes are superseded), else the whole folder
    sub=$(gh api "repos/$REPO/git/trees/$sha" -q ".tree[] | select(.type == \"tree\" and .path == \"$head\") | .sha")
    if [ -n "$sub" ]; then
      jq -n --arg p "$path/$head" --arg s "$sub" '{path: $p, mode: "040000", type: "tree", sha: $s}'
    else
      jq -n --arg p "$path" --arg s "$sha" '{path: $p, mode: "040000", type: "tree", sha: $s}'
    fi
  done | jq -s .)
kept=$(jq length <<<"$entries")  # one entry per open PR with evidence
total=$(gh api "repos/$REPO/git/trees/$root" -q '[.tree[] | select(.type == "tree")] | length')
echo "pr-previews $old: keeping $kept of $total PR folders ($(jq -r '[.[].path] | join(" ")' <<<"$entries"))"
if [ "$kept" -eq 0 ]; then echo "no open PR has a folder: nothing to keep, leaving the branch as is"; exit 0; fi
[ -n "${DRY_RUN:-}" ] && { echo "DRY_RUN: no changes"; exit 0; }
tree=$(jq -n --argjson t "$entries" '{tree: $t}' | gh api "repos/$REPO/git/trees" --input - -q .sha)
new=$(jq -n --arg t "$tree" --arg m "chore(previews): prune to the latest evidence of $kept open PRs" \
  '{message: $m, tree: $t, parents: []}' | gh api "repos/$REPO/git/commits" --input - -q .sha)
now=$(gh api "repos/$REPO/git/ref/heads/pr-previews" -q .object.sha)
if [ "$now" != "$old" ]; then echo "pr-previews moved to $now during the prune: leaving it for the next run"; exit 0; fi
gh api -X PATCH "repos/$REPO/git/refs/heads/pr-previews" -f sha="$new" -F force=true -q '"pr-previews -> " + .object.sha'
