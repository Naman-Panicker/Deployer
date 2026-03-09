import express, { type Request, type Response } from "express";
import cors from "cors";
import generateStr from "./generate.js";
import {simpleGit} from "simple-git";
import path from "node:path";
import { fileURLToPath } from "node:url";
import getAllFiles from "./files.js";
import uploadFiles from "./aws.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import dotenv from "dotenv"


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


const publisher = new SQSClient({
    region: "ap-southeast-2",
    credentials:{
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
    }
})


app.use(express.json())
app.use(cors())


app.post("/api/v1/upload", async (req: Request, res: Response)=>{

    console.log("at post")

    const url: string = req.body.url;
    console.log(url)

    const id = generateStr();
    console.log(id)

    try{
        await simpleGit().clone(url, path.join(__dirname,`/output/${id}`))

        const files = getAllFiles(path.join(__dirname,`/output/${id}`))

        await Promise.all(files.map((file) =>
            uploadFiles(file.split("/dist/")[1]!, file)
        ));

        const command = new SendMessageCommand(
            {
                QueueUrl: sqsUrl,
                MessageBody: JSON.stringify({ id }),
                MessageGroupId: "deploy",        
                MessageDeduplicationId: id,      
            }
        )

        await publisher.send(command)

        res.json({ id })


    }catch(error){
        console.log(error)
        res.status(500).json({
            message: "Deploymeny Failed"
        })
    }

    
})

app.listen(3000);