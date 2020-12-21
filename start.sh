#!/bin/bash

cd ./rdata
Rscript server.R & 
status=$?
if [ $status -ne 0 ]; then
  echo "Failed to start rdata: $status"
  exit $status
fi

cd ../api
RDATA_BASE_URL=http://0.0.0.0:7000 API_BASE_URL=http://0.0.0.0:5000 NODE_DEBUG=[api] npm run start &
status=$?
if [ $status -ne 0 ]; then
  echo "Failed to start api: $status"
  exit $status
fi

# Start the second process
cd ../frontend
RDATA_BASE_URL=http://0.0.0.0:7000 API_BASE_URL=http://0.0.0.0:5000 NODE_DEBUG=[frontend] npm run start &
status=$?
if [ $status -ne 0 ]; then
  echo "Failed to start frontend: $status"
  exit $status
fi

# Naive check runs checks once a minute to see if either of the processes exited.
# This illustrates part of the heavy lifting you need to do if you want to run
# more than one service in a container. The container exits with an error
# if it detects that either of the processes has exited.
# Otherwise it loops forever, waking up every 60 seconds

while sleep 60; do
  ps aux |grep [rdata] |grep -q -v grep
  PROCESS_0_STATUS=$?
  ps aux |grep [api] |grep -q -v grep
  PROCESS_1_STATUS=$?
  ps aux |grep [frontend] |grep -q -v grep
  PROCESS_2_STATUS=$?
  # If the greps above find anything, they exit with 0 status
  # If they are not both 0, then something is wrong
  if [ $PROCESS_0_STATUS -ne 0 ]; then
    echo "RData process has exited"
    ps aux |grep [rdata] |grep -q -v grep
    exit 1
  fi
  if [ $PROCESS_1_STATUS -ne 0 ]; then
    echo "API process has exited"
    ps aux |grep [api] |grep -q -v grep
    exit 1
  fi
  if [ $PROCESS_2_STATUS -ne 0 ]; then
    echo "Frontend process has exited"
    ps aux |grep [frontend] |grep -q -v grep
    exit 1
  fi
done