import express, {type Request, type Response} from "express";
import cors from "cors";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv"
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const app = express();

app.use(express.json())
app.use(cors());

const accessKeyId = process.env.ACCESS_KEY;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;
const bucketName = process.env.BUCKET_NAME!;
const region = "ap-southeast-2";

if(!accessKeyId || !secretAccessKey || !bucketName){
    throw new Error("Please set ACCESS_KEY, SECRET_ACCESS_KEY, and BUCKET_NAME in .env")
}

const client = new S3Client({
    region,
    credentials:{
        accessKeyId,
        secretAccessKey
    }
})

function getMimeType(filePath: string): string {
    if (filePath.endsWith(".html") || filePath === "" || filePath.endsWith("/")) return "text/html";
    if (filePath.endsWith(".css")) return "text/css";
    if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "application/javascript";
    if (filePath.endsWith(".json")) return "application/json";
    if (filePath.endsWith(".svg")) return "image/svg+xml";
    if (filePath.endsWith(".png")) return "image/png";
    if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
    if (filePath.endsWith(".ico")) return "image/x-icon";
    if (filePath.endsWith(".woff2")) return "font/woff2";
    if (filePath.endsWith(".woff")) return "font/woff";
    if (filePath.endsWith(".ttf")) return "font/ttf";
    return "application/octet-stream";
}

app.get("/{*splat}", async (req: Request, res: Response)=>{
    const startTime = Date.now();
    const host = req.hostname;
    const id = host.split(".")[0];
    let filePath = req.path.slice(1);

    // Default to index.html for root or SPA routing
    if (!filePath || filePath === "") {
        filePath = "index.html";
    }

    const s3Key = `build/${id}/${filePath}`;
    console.log(`\x1b[36m[${new Date().toISOString()}]\x1b[0m \x1b[34m[REQUEST-HANDLER]\x1b[0m \x1b[35m[ID: ${id}]\x1b[0m Fetching: ${s3Key}`);

    try {
        const contents = await client.send(new GetObjectCommand({
            Bucket: bucketName,
            Key: s3Key
        }));

        const mimeType = getMimeType(filePath);
        res.set("Content-Type", mimeType);

        const bodyContents = await contents.Body?.transformToByteArray();
        if (bodyContents) {
            const duration = Date.now() - startTime;
            console.log(`\x1b[36m[${new Date().toISOString()}]\x1b[0m \x1b[34m[REQUEST-HANDLER]\x1b[0m \x1b[32m[200 OK]\x1b[0m \x1b[35m[ID: ${id}]\x1b[0m ${s3Key} (${mimeType}, ${bodyContents.length} bytes, ${duration}ms)`);
            res.send(Buffer.from(bodyContents));
        } else {
            res.status(404).send("File body empty");
        }
    } catch(error) {
        const duration = Date.now() - startTime;
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(
            `\x1b[31m[${new Date().toISOString()}] [REQUEST-HANDLER] [404/ERR] [ID: ${id}] Failed to serve ${s3Key} (${duration}ms): ${err.message}\x1b[0m`
        );
        res.status(404).send(`Not Found: ${filePath} in deployment ${id}`);
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`\x1b[36m[${new Date().toISOString()}]\x1b[0m \x1b[34m[REQUEST-HANDLER]\x1b[0m Request Handler running on http://localhost:${PORT}`);
});
