import fs, { readFileSync } from "fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";



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

    const input = {
        Bucket: bucketName,
        Key: fileName,
        Body: fs.readFileSync(filePath)
    }

    const command = new PutObjectCommand(input)

    try{
        const response = await client.send(command)
        console.log(response)
    }catch(error){
        console.log("Error! Couldn't Upload Files\n", error)
    }

    
}