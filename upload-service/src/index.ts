import express, { type Request, type Response } from "express";
import cors from "cors";
import generateStr from "./generate.js";
import { simpleGit } from "simple-git";
import path from "node:path";
import { fileURLToPath } from "node:url";
import getAllFiles from "./files.js";
import uploadFiles from "./aws.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import dotenv from "dotenv"
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const app = express();
const accessKeyId = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;
const sqsUrl = process.env.SQS_QUEUE_URL;
const bucketName = process.env.BUCKET_NAME;
const region = "ap-southeast-2";

if(!accessKeyId || !secretAccessKey || !sqsUrl || !bucketName){
    throw new Error("Please set ACCESS_KEY, SECRET_ACCESS_KEY, SQS_QUEUE_URL, and BUCKET_NAME in .env")
}

const publisher = new SQSClient({
    region,
    credentials:{
        accessKeyId,
        secretAccessKey
    }
})

app.use(express.json())
app.use(cors())

// Request logger middleware
app.use((req: Request, _res: Response, next) => {
    logger.info("UPLOAD-SERVICE", `Incoming ${req.method} ${req.originalUrl} from ${req.ip}`);
    next();
});

app.post("/api/v1/upload", async (req: Request, res: Response)=>{
    const startTime = Date.now();
    const url: string = req.body.url;

    logger.info("UPLOAD-SERVICE", `Deployment upload request received`, { url });

    if (!url || typeof url !== "string" || url.trim() === "") {
        logger.warn("UPLOAD-SERVICE", "Validation error: Missing or empty repository URL");
        res.status(400).json({
            error: {
                step: "VALIDATION",
                message: "Repository URL is required and must be a valid git URL",
            }
        });
        return;
    }

    const id = generateStr();
    const outputDir = path.join(__dirname, `/output/${id}`);
    logger.info("UPLOAD-SERVICE", `Generated deployment identifier`, { id, targetDir: outputDir });

    try {
        // Step 1: Git Clone
        const cloneStart = Date.now();
        logger.step("UPLOAD-SERVICE", id, 1, 3, "CLONING", `Cloning git repository from ${url} to ${outputDir}...`);
        
        await simpleGit().clone(url, outputDir);
        const cloneDuration = ((Date.now() - cloneStart) / 1000).toFixed(2);
        logger.success("UPLOAD-SERVICE", `Git repository successfully cloned in ${cloneDuration}s`, id);

        // Step 2: File Discovery & Upload to S3
        const uploadStart = Date.now();
        logger.step("UPLOAD-SERVICE", id, 2, 3, "UPLOADING_SOURCE", `Scanning source directory: ${outputDir}`);
        const files = getAllFiles(outputDir);
        
        logger.info("UPLOAD-SERVICE", `Discovered ${files.length} source files to upload to S3 bucket [${bucketName}]`, { id, count: files.length });

        let completedFiles = 0;
        await Promise.all(files.map(async (file) => {
            const s3Key = path.join(`output/${id}`, path.relative(outputDir, file));
            await uploadFiles(s3Key, file);
            completedFiles++;
            if (completedFiles % 10 === 0 || completedFiles === files.length) {
                logger.info("UPLOAD-SERVICE", `Upload progress: ${completedFiles}/${files.length} files transferred to S3`, { id });
            }
        }));

        const uploadDuration = ((Date.now() - uploadStart) / 1000).toFixed(2);
        logger.success("UPLOAD-SERVICE", `All ${files.length} source files uploaded to S3 in ${uploadDuration}s`, id);

        // Step 3: Queue deployment via SQS
        const queueStart = Date.now();
        logger.step("UPLOAD-SERVICE", id, 3, 3, "QUEUED", `Dispatching deployment message to SQS Queue: ${sqsUrl}`);
        
        const command = new SendMessageCommand(
            {
                QueueUrl: sqsUrl,
                MessageBody: JSON.stringify({ id }),
                MessageGroupId: "deploy",
                MessageDeduplicationId: id,
            }
        );

        const sqsResponse = await publisher.send(command);
        const queueDuration = ((Date.now() - queueStart) / 1000).toFixed(2);
        logger.success("UPLOAD-SERVICE", `SQS message dispatched successfully (MessageId: ${sqsResponse.MessageId}) in ${queueDuration}s`, id);

        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
        logger.success("UPLOAD-SERVICE", `Upload phase complete! Deployment queued with ID [${id}] in ${totalDuration}s total.`, id);

        res.json({
            id,
            completedSteps: ['CLONING', 'UPLOADING_SOURCE', 'QUEUED'],
            durationSeconds: totalDuration,
        });

    } catch (error) {
        const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
        const err = error instanceof Error ? error : new Error(String(error));

        // Determine which step failed
        let failedStep = "UNKNOWN";
        let stepLocation = "upload-service pipeline";
        if (err.message.includes("clone") || err.message.includes("git") || err.message.includes("repository") || err.message.includes("destination path")) {
            failedStep = "CLONING";
            stepLocation = `simpleGit().clone(${url})`;
        } else if (err.message.includes("upload") || err.message.includes("S3") || err.message.includes("PutObject") || err.message.includes("NoSuchBucket")) {
            failedStep = "UPLOADING_SOURCE";
            stepLocation = `uploadFiles to S3 bucket [${bucketName}]`;
        } else if (err.message.includes("SQS") || err.message.includes("SendMessage") || err.message.includes("QueueDoesNotExist")) {
            failedStep = "QUEUED";
            stepLocation = `SQS SendMessageCommand to [${sqsUrl}]`;
        }

        logger.error(
            "UPLOAD-SERVICE",
            id,
            stepLocation,
            `Deployment upload phase failed during ${failedStep}: ${err.message}`,
            {
                step: failedStep,
                stack: err.stack,
                context: {
                    repositoryUrl: url,
                    deploymentId: id,
                    elapsedSeconds: totalDuration,
                    targetDir: outputDir,
                }
            }
        );

        res.status(500).json({
            error: {
                step: failedStep,
                message: err.message,
                stack: err.stack,
            }
        });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    logger.info("UPLOAD-SERVICE", `=====================================================`);
    logger.info("UPLOAD-SERVICE", `Upload Service running on http://localhost:${PORT}`);
    logger.info("UPLOAD-SERVICE", `Target SQS Queue: ${sqsUrl}`);
    logger.info("UPLOAD-SERVICE", `Target S3 Bucket: ${bucketName}`);
    logger.info("UPLOAD-SERVICE", `AWS Region: ${region}`);
    logger.info("UPLOAD-SERVICE", `=====================================================`);
});