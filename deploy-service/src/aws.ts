import fs from "fs";
import { GetObjectCommand, ListObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

export default async function downloadS3Folder(prefix: string) {
    const startTime = Date.now();
    logger.info("DEPLOY-SERVICE", `Querying S3 for objects with prefix: [${prefix}] in bucket [${bucketName}]`);

    let files;
    try {
        files = await client.send(new ListObjectsCommand({
            Bucket: bucketName,
            Prefix: prefix
        }));
    } catch (listErr) {
        const err = listErr instanceof Error ? listErr : new Error(String(listErr));
        logger.error("DEPLOY-SERVICE", undefined, `ListObjectsCommand (prefix: ${prefix})`, `Failed to list files from S3 bucket ${bucketName}`, {
            stack: err.stack,
            context: { bucket: bucketName, prefix }
        });
        throw err;
    }

    if (!files.Contents || files.Contents.length === 0) {
        logger.warn("DEPLOY-SERVICE", `No files found in S3 under prefix [${prefix}]`);
        return;
    }

    logger.info("DEPLOY-SERVICE", `Found ${files.Contents.length} files in S3 under [${prefix}]. Starting download to disk...`);

    let downloadedCount = 0;
    const allPromises = files.Contents.map(async ({ Key }) => {
        if (!Key) return;
        const finalOutputPath = path.join(__dirname, Key);
        const dirName = path.dirname(finalOutputPath);
        if (!fs.existsSync(dirName)) {
            fs.mkdirSync(dirName, { recursive: true });
        }

        try {
            const response = await client.send(new GetObjectCommand({
                Bucket: bucketName,
                Key: Key
            }));

            await new Promise<void>((resolve, reject) => {
                const outputFile = fs.createWriteStream(finalOutputPath);
                (response.Body as NodeJS.ReadableStream)
                    .pipe(outputFile)
                    .on("finish", () => {
                        downloadedCount++;
                        resolve();
                    })
                    .on("error", (streamErr) => {
                        reject(streamErr);
                    });
            });
        } catch (downloadErr) {
            const err = downloadErr instanceof Error ? downloadErr : new Error(String(downloadErr));
            logger.error("DEPLOY-SERVICE", undefined, `GetObjectCommand (Key: ${Key})`, `Failed to download file from S3: ${Key}`, {
                stack: err.stack,
                context: { bucket: bucketName, key: Key, localTarget: finalOutputPath }
            });
            throw err;
        }
    });

    await Promise.all(allPromises);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.success("DEPLOY-SERVICE", `Downloaded ${downloadedCount} files from S3 to local filesystem in ${duration}s`);
}

export async function uploadBuildFiles(fileName: string, filePath: string){
    const fileStats = fs.statSync(filePath);
    const input = {
        Bucket: bucketName,
        Key: fileName,
        Body: fs.readFileSync(filePath)
    }

    const command = new PutObjectCommand(input)

    try {
        await client.send(command);
    } catch(error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("DEPLOY-SERVICE", undefined, `uploadBuildFiles (Key: ${fileName})`, `Failed to upload build file to S3: ${fileName}`, {
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