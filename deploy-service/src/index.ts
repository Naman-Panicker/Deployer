import express, { type Request, type Response } from "express";
import cors from "cors";
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
            const {id} = JSON.parse(message?.Body!)

            console.log("Deploying Project: ", id)


            await downloadS3Folder(`output/${id}`) 

            await buildProject(id) 


            const files = getBuildFiles(path.join(__dirname,`/output/${id}/dist`)) 

            await Promise.all(files.map((file) =>
                uploadBuildFiles(path.join(`build/${id}`, file.split(`/output/${id}/dist/`)[1]!), file)
            ));



            //delete logic

            await subscriber.send(new DeleteMessageCommand(
                {
                    QueueUrl: sqsUrl,
                    ReceiptHandle: message?.ReceiptHandle!,
                })
            )
        }
    }
}

deploy();