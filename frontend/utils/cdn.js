const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const DIGITAL_OCEAN_SPACES_CLIENT = new S3Client({
    endpoint: process.env.DIGITAL_OCEAN_SPACES_ENDPOINT_URL,
    region: 'us-east-1',
    forcePathStyle: false,
    credentials: {
      accessKeyId: process.env.DIGITAL_OCEAN_SPACES_KEY,
      secretAccessKey: process.env.DIGITAL_OCEAN_SPACES_SECRET
    }
});
const DIGITAL_OCEAN_SPACES_BUCKET_NAME = process.env.DIGITAL_OCEAN_SPACES_BUCKET_NAME;

async function putCdnFile(key, content, bucket = DIGITAL_OCEAN_SPACES_BUCKET_NAME) {
    try {
        const input = {
            Bucket: bucket,
            Key: key,
            Body: content,
            Metadata: {
                "UploadedBy": "node-worker"
            },
            ACL: "public-read",
            ContentDisposition: "inline",
            ContentType: "text/html",
        }
        const command = new PutObjectCommand(input);
        await DIGITAL_OCEAN_SPACES_CLIENT.send(command);
    } catch (err) {
        console.log(err, err.stack);
    }
}


module.exports = {
    putCdnFile,
    DIGITAL_OCEAN_SPACES_BUCKET_NAME
}