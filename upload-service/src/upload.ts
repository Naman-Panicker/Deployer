import express, { type Request, type Response } from "express";
import cors from "cors";
import generateStr from "./generate.js";
import {simpleGit} from "simple-git";
import path from "node:path";
import { fileURLToPath } from "node:url";
import getAllFiles from "./files.js";
import uploadFiles from "./aws.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

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

        files.forEach((file)=>{

            uploadFiles(file.split("/dist/")[1]!, file)
            
        })


    }catch(error){
        console.log(error)
    }

    
    

})

app.listen(3000);