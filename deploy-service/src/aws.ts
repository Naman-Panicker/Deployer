import fs from "fs";
import { GetObjectCommand, ListObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

export default async function downloadS3Folder(prefix:string) {
        
    const files = await client.send( new ListObjectsCommand({
            Bucket: bucketName,
            Prefix: prefix
        })
    )

    const allPromises = files.Contents?.map(async ({Key}) => {
        return new Promise(async (resolve) => {
            if (!Key) {
                resolve("");
                return;
            }
            const finalOutputPath = path.join(__dirname, Key);
            const outputFile = fs.createWriteStream(finalOutputPath);
            const dirName = path.dirname(finalOutputPath);
            if (!fs.existsSync(dirName)){
                fs.mkdirSync(dirName, { recursive: true });
            }
            const response = await client.send( new GetObjectCommand({
                Bucket: bucketName,
                Key: Key
            }));

            (response.Body as NodeJS.ReadableStream)
            .pipe(outputFile)
            .on("finish", ()=>{
                resolve("")
            })
        })
    }) || []
    console.log("awaiting");

    await Promise.all(allPromises?.filter(x => x !== undefined));
}


export async function uploadBuildFiles(fileName: string, filePath: string){


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