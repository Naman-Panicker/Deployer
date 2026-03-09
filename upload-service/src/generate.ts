export default function generateStr(){

    const str = "123456789qwertyuiopasdfghjklzxcvbnm";
    const length = 5;
    let id = ""
    
    for (let i=0;i<length;i++){
        let letter = str.split("")[Math.floor(Math.random()*str.length)] as string
        id+=letter
    }

    return id;
}