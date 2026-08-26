import fs from "fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const accessKeyId = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;
if(!accessKeyId || !secretAccessKey){
    throw new Error("Please set Access and Secret Keys")
}
const bucketName = process.env.BUCKET_NAME!

const client = new S3Client({
    region: "ap-southeast-2",
    credentials:{
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
    }
})

export default async function uploadFiles(fileName: string, filePath: string){
    const fileStats = fs.statSync(filePath);
    const input = {
        Bucket: bucketName,
        Key: fileName,
        Body: fs.readFileSync(filePath)
    }

    const command = new PutObjectCommand(input)

    try {
        await client.send(command)
    } catch(error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("UPLOAD-SERVICE", undefined, "uploadFiles (S3)", `Failed to upload ${fileName} to bucket ${bucketName}`, {
            stack: err.stack,
            context: {
                bucket: bucketName,
                key: fileName,
                localPath: filePath,
                fileSizeBytes: fileStats.size
            }
        });
        throw err;
    }
}