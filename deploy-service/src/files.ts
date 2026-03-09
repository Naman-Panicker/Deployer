import fs from "fs"
import path from "node:path";

export default function getBuildFiles(filepath: string){

     let response: string[] = [];

     const files = fs.readdirSync(filepath)

     files.forEach((file)=>{
        const fullfilePath = path.join(filepath,file)
        if(fs.statSync(fullfilePath).isDirectory()){
            response = response.concat(getBuildFiles(fullfilePath))
        }else{
            response.push(fullfilePath);
        }
     })

     return response;

}