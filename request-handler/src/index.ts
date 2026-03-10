import express, {type Request, type Response} from "express";
import cors from "cors";
import { GetObjectCommand, ListObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv"




const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const app = express();

app.use(express.json())
app.use(cors());


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

app.get("/{*splat}", async (req: Request, res: Response)=>{

	const host = req.hostname;
	console.log(host)
	const id = host.split(".")[0];
	console.log(id)


	const filePath = req.path.slice(1)
	console.log(filePath)

	const contents = await client.send( new GetObjectCommand({
		Bucket: bucketName,
		Key: `build/${id}/${filePath}`
	}))
	
	// const type = filePath.endsWith("html") ? "text/html" : filePath.endsWith("css") ? "text/css" : "application/javascript";

	let type = null;

	if(filePath.endsWith("html")){
		type = "text/html";
	}else if(filePath.endsWith("css")){
		type = "text/css";
	}else{
		type = "application/javascript";
	}

	res.set("Content-Type", type);

	const bodyContents = await contents.Body?.transformToString();
	res.send(Buffer.from(bodyContents!));

})


app.listen(3001);
