import express, { type Request, type Response } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import dotenv from "dotenv"
import downloadS3Folder, { uploadBuildFiles } from "./aws.js";
import { buildProject } from "./build.js";
import getBuildFiles from "./files.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") })


const app = express();

const accessKeyId = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;
const sqsUrl = process.env.SQS_QUEUE_URL;

if(!accessKeyId || !secretAccessKey || !sqsUrl){
    throw new Error("Please set env variables with AWS keys")
}

const subscriber = new SQSClient({
    region: "ap-southeast-2",
    credentials:{
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
    }
})


app.use(express.json())
app.use(cors())


const deploy = async ()=>{

    while(true){

        const {Messages} = await subscriber.send(
            new ReceiveMessageCommand({
                    QueueUrl: sqsUrl,
                    MaxNumberOfMessages: 1,
                    WaitTimeSeconds: 20,
                }
            )
        )

        if(Messages && Messages.length > 0){
            const message = Messages[0];
            const {id} = JSON.parse(message?.Body!) //the excalamation marks are for ts error suppression

            console.log("Deploying Project: ", id)

            try {
                await downloadS3Folder(`output/${id}`) 

                await buildProject(id) 

                const distPath = path.join(__dirname, `output/${id}/dist`)
                if (!fs.existsSync(distPath)) {
                    throw new Error(`Build output directory does not exist at: ${distPath}`)
                }

                const files = getBuildFiles(distPath)

                await Promise.all(files.map((file) => {
                    const relativePath = path.relative(distPath, file)
                    return uploadBuildFiles(path.join(`build/${id}`, relativePath), file)
                }));

                console.log(`Successfully deployed project: ${id}`)

                //delete logic
                await subscriber.send(new DeleteMessageCommand(
                    {
                        QueueUrl: sqsUrl,
                        ReceiptHandle: message?.ReceiptHandle!,
                    })
                )
            } catch (error) {
                console.error(`Deployment failed for project ${id}:`, error)
            }
        }
    }
}

deploy();