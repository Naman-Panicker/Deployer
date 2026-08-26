import express, { type Request, type Response } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import dotenv from "dotenv"
import downloadS3Folder, { uploadBuildFiles } from "./aws.js";
import { buildProject } from "./build.js";
import getBuildFiles from "./files.js";
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

const subscriber = new SQSClient({
    region,
    credentials:{
        accessKeyId,
        secretAccessKey
    }
})

app.use(express.json())
app.use(cors())

// ── In-memory deployment status tracking ──

type DeploymentStatus = {
    id: string;
    status: 'QUEUED' | 'DOWNLOADING' | 'BUILDING' | 'UPLOADING_BUILD' | 'DEPLOYED' | 'FAILED';
    message: string;
    timestamp: number;
    logs: string[];
    error?: {
        step: string;
        message: string;
        stack?: string;
        details?: string;
    };
};

const deploymentStatuses = new Map<string, DeploymentStatus>();
const sseClients = new Map<string, Set<Response>>();

function publishStatus(
    id: string,
    status: DeploymentStatus['status'],
    message: string,
    extra?: { error?: DeploymentStatus['error']; log?: string }
) {
    let entry = deploymentStatuses.get(id);
    if (!entry) {
        entry = { id, status, message, timestamp: Date.now(), logs: [] };
        deploymentStatuses.set(id, entry);
    }

    entry.status = status;
    entry.message = message;
    entry.timestamp = Date.now();

    if (extra?.error) {
        entry.error = extra.error;
    }
    if (extra?.log) {
        entry.logs.push(extra.log);
    }

    // Push to all connected SSE clients for this deployment
    const clients = sseClients.get(id);
    if (clients && clients.size > 0) {
        const eventData = JSON.stringify({
            id: entry.id,
            status: entry.status,
            message: entry.message,
            timestamp: entry.timestamp,
            logs: extra?.log ? extra.log : undefined,
            error: entry.error,
        });

        for (const client of clients) {
            client.write(`data: ${eventData}\n\n`);
        }
        logger.info("DEPLOY-SERVICE", `Broadcasted status update [${status}] to ${clients.size} SSE client(s)`, { id });
    }
}

function publishLog(id: string, log: string) {
    const entry = deploymentStatuses.get(id);
    if (entry) {
        entry.logs.push(log);
    }

    const clients = sseClients.get(id);
    if (clients && clients.size > 0) {
        const eventData = JSON.stringify({
            id,
            status: entry?.status,
            message: entry?.message,
            timestamp: Date.now(),
            logs: log,
        });
        for (const client of clients) {
            client.write(`data: ${eventData}\n\n`);
        }
    }
}


// ── Status Endpoint (Supports both SSE and JSON Polling) ──

app.get("/api/v1/status/:id", (req: Request, res: Response) => {
    const id = req.params.id as string;
    const isSse = req.headers.accept?.includes("text/event-stream") || req.query.stream === "true";

    const current = deploymentStatuses.get(id) || {
        id,
        status: 'QUEUED' as const,
        message: 'Waiting for deployment to start...',
        timestamp: Date.now(),
        logs: [],
    };

    if (!isSse) {
        // Return standard JSON for polling
        res.json({
            id: current.id,
            status: current.status,
            message: current.message,
            timestamp: current.timestamp,
            logs: current.logs,
            error: current.error,
        });
        return;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    logger.info("DEPLOY-SERVICE", `[SSE] Client connected to live status stream for ID: ${id}`);

    // Send initial status event
    const eventData = JSON.stringify({
        id: current.id,
        status: current.status,
        message: current.message,
        timestamp: current.timestamp,
        error: current.error,
    });
    res.write(`data: ${eventData}\n\n`);

    // Register this client
    if (!sseClients.has(id)) {
        sseClients.set(id, new Set());
    }
    sseClients.get(id)!.add(res);

    // Clean up on disconnect
    req.on("close", () => {
        logger.info("DEPLOY-SERVICE", `[SSE] Client disconnected for ID: ${id}`);
        sseClients.get(id)?.delete(res);
        if (sseClients.get(id)?.size === 0) {
            sseClients.delete(id);
        }
    });
});


// ── Deploy Worker Loop ──

const deploy = async ()=>{
    logger.info("DEPLOY-SERVICE", `Starting SQS Poller on Queue: ${sqsUrl}`);

    while(true){
        try {
            const { Messages } = await subscriber.send(
                new ReceiveMessageCommand({
                    QueueUrl: sqsUrl,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 20,
                })
            );

            if(Messages && Messages.length > 0){
                const message = Messages[0];
                if (!message || !message.Body) continue;

                const deployStartTime = Date.now();
                const { id } = JSON.parse(message.Body);

                logger.info("DEPLOY-SERVICE", `=====================================================`);
                logger.info("DEPLOY-SERVICE", `Received deployment job for Project ID [${id}] from SQS (MessageId: ${message.MessageId})`);
                logger.info("DEPLOY-SERVICE", `=====================================================`);

                try {
                    // Step 1: Download from S3
                    const step1Start = Date.now();
                    logger.step("DEPLOY-SERVICE", id, 4, 7, "DOWNLOADING", `Downloading source files from S3 prefix [output/${id}]...`);
                    publishStatus(id, 'DOWNLOADING', 'Downloading source files from S3...');
                    
                    await downloadS3Folder(`output/${id}`);
                    const step1Duration = ((Date.now() - step1Start) / 1000).toFixed(2);
                    logger.success("DEPLOY-SERVICE", `Downloaded source files in ${step1Duration}s`, id);

                    // Step 2: Build project (npm install && npm run build)
                    const step2Start = Date.now();
                    logger.step("DEPLOY-SERVICE", id, 5, 7, "BUILDING", `Building project: executing npm install && npm run build...`);
                    publishStatus(id, 'BUILDING', 'Building project (npm install & build)...');
                    
                    await buildProject(id, (log) => publishLog(id, log));
                    const step2Duration = ((Date.now() - step2Start) / 1000).toFixed(2);
                    logger.success("DEPLOY-SERVICE", `Build process finished in ${step2Duration}s`, id);

                    // Step 3: Upload build artifacts to S3
                    const step3Start = Date.now();
                    logger.step("DEPLOY-SERVICE", id, 6, 7, "UPLOADING_BUILD", `Scanning and uploading build artifacts to S3...`);
                    publishStatus(id, 'UPLOADING_BUILD', 'Uploading build artifacts to S3...');
                    
                    const distPath = path.join(__dirname, `output/${id}/dist`);
                    if (!fs.existsSync(distPath)) {
                        throw new Error(`Build output directory does not exist at: ${distPath}. Ensure your project has a "build" script that outputs to "dist/".`);
                    }

                    const files = getBuildFiles(distPath);
                    logger.info("DEPLOY-SERVICE", `Found ${files.length} build artifact files in ${distPath}`, { id });

                    let uploadedCount = 0;
                    await Promise.all(files.map(async (file) => {
                        const relativePath = path.relative(distPath, file);
                        const s3Key = path.join(`build/${id}`, relativePath);
                        await uploadBuildFiles(s3Key, file);
                        uploadedCount++;
                        if (uploadedCount % 10 === 0 || uploadedCount === files.length) {
                            logger.info("DEPLOY-SERVICE", `Upload progress: ${uploadedCount}/${files.length} build artifacts transferred to S3`, { id });
                        }
                    }));

                    const step3Duration = ((Date.now() - step3Start) / 1000).toFixed(2);
                    logger.success("DEPLOY-SERVICE", `All ${files.length} build artifacts uploaded to S3 in ${step3Duration}s`, id);

                    // Step 4: Deployed!
                    const totalDeployDuration = ((Date.now() - deployStartTime) / 1000).toFixed(2);
                    const deployedUrl = `http://${id}.localhost:3001`;
                    
                    publishStatus(id, 'DEPLOYED', `Successfully deployed! Your site is live.`);
                    logger.step("DEPLOY-SERVICE", id, 7, 7, "DEPLOYED", `Deployment complete! Site URL: ${deployedUrl} (Total deploy time: ${totalDeployDuration}s)`);

                    // Delete SQS message
                    if (message.ReceiptHandle) {
                        logger.info("DEPLOY-SERVICE", `Deleting message from SQS queue`, { id, messageId: message.MessageId });
                        await subscriber.send(new DeleteMessageCommand({
                            QueueUrl: sqsUrl,
                            ReceiptHandle: message.ReceiptHandle,
                        }));
                        logger.success("DEPLOY-SERVICE", `SQS message deleted successfully`, id);
                    }

                } catch (error) {
                    const totalDuration = ((Date.now() - deployStartTime) / 1000).toFixed(2);
                    const currentStatus = deploymentStatuses.get(id);
                    const failedStep = currentStatus?.status || 'UNKNOWN';
                    const err = error instanceof Error ? error : new Error(String(error));

                    const errorInfo: DeploymentStatus['error'] = {
                        step: failedStep,
                        message: err.message,
                    };
                    if (err.stack) {
                        errorInfo.stack = err.stack;
                    }
                    const logDetails = currentStatus?.logs.slice(-50).join('');
                    if (logDetails) {
                        errorInfo.details = logDetails;
                    }

                    publishStatus(id, 'FAILED', `Deployment failed during: ${failedStep}`, {
                        error: errorInfo,
                    });

                    logger.error(
                        "DEPLOY-SERVICE",
                        id,
                        `deploy-service worker (${failedStep})`,
                        `Deployment failed during step [${failedStep}]: ${err.message}`,
                        {
                            step: failedStep,
                            stack: err.stack,
                            context: {
                                deploymentId: id,
                                elapsedSeconds: totalDuration,
                                lastLogs: currentStatus?.logs.slice(-5) || [],
                            }
                        }
                    );

                    // Delete SQS message to prevent infinite retry loop on failed build
                    if (message.ReceiptHandle) {
                        try {
                            logger.warn("DEPLOY-SERVICE", `Removing failed deployment message from SQS to avoid retry loop`, id);
                            await subscriber.send(new DeleteMessageCommand({
                                QueueUrl: sqsUrl,
                                ReceiptHandle: message.ReceiptHandle,
                            }));
                        } catch (deleteErr) {
                            const dErr = deleteErr instanceof Error ? deleteErr : new Error(String(deleteErr));
                            logger.error("DEPLOY-SERVICE", id, "SQS DeleteMessageCommand", `Failed to delete message from SQS: ${dErr.message}`, {
                                stack: dErr.stack
                            });
                        }
                    }
                }
            }
        } catch (pollError) {
            const err = pollError instanceof Error ? pollError : new Error(String(pollError));
            logger.error("DEPLOY-SERVICE", undefined, "SQS ReceiveMessageCommand", `Failed to poll SQS queue: ${err.message}`, {
                stack: err.stack,
                context: { sqsUrl, region }
            });
            // Wait briefly before retrying poll
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

const PORT = 3002;
app.listen(PORT, () => {
    logger.info("DEPLOY-SERVICE", `=====================================================`);
    logger.info("DEPLOY-SERVICE", `Deploy Status Server running on http://localhost:${PORT}`);
    logger.info("DEPLOY-SERVICE", `Target SQS Queue: ${sqsUrl}`);
    logger.info("DEPLOY-SERVICE", `Target S3 Bucket: ${bucketName}`);
    logger.info("DEPLOY-SERVICE", `AWS Region: ${region}`);
    logger.info("DEPLOY-SERVICE", `=====================================================`);
});

deploy();