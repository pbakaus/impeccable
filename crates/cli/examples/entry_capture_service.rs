//! Offline prototype: one registered root, shared native capture/verify/release.
//! Not a shipped CLI verb or an eval approval endpoint.
use base64::Engine;
use impeccable::entry_capture::CdpEntryRenderer;
use impeccable_comp_verbs::entry_capture::{CapturedEntry, EntryRenderer, EntryRequest, EntryStage};
use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Read, Write}, net::{TcpListener, TcpStream}, path::PathBuf, time::{Duration, Instant}};

fn request(stream: &TcpStream, key: &str) -> Result<(String, Value), String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut first = String::new(); reader.by_ref().take(1025).read_line(&mut first).map_err(|e|e.to_string())?;
    if first.len() > 1024 { return Err("request line too long".into()); }
    let parts: Vec<_> = first.split_whitespace().collect();
    if parts.len()!=3 || parts[0]!="POST" { return Err("POST required".into()); }
    let route=parts[1].to_string(); let mut total=first.len(); let mut length=None; let mut authenticated=false;
    loop {
        let mut line=String::new(); reader.by_ref().take(8193).read_line(&mut line).map_err(|e|e.to_string())?;
        total+=line.len(); if total>8192 || line.is_empty() {return Err("invalid headers".into());}
        if line=="\r\n" || line=="\n" {break;}
        let (name,value)=line.split_once(':').ok_or("invalid header")?;
        match name.to_ascii_lowercase().as_str() {
            "content-length"=>{if length.is_some(){return Err("duplicate length".into());} length=Some(value.trim().parse::<usize>().map_err(|_|"invalid length")?);},
            "x-capture-key"=>authenticated=value.trim()==key,
            "origin"|"transfer-encoding"=>return Err("unsupported request origin/encoding".into()),
            _=>{}
        }
    }
    if !authenticated {return Err("invalid capability".into());}
    let length=length.ok_or("missing length")?;if length>16384{return Err("request too large".into());}
    let mut body=vec![0;length];reader.read_exact(&mut body).map_err(|e|e.to_string())?;
    let body:Value=serde_json::from_slice(&body).map_err(|e|e.to_string())?;
    if !body.is_object() || body.get("root").is_some() || body.get("url").is_some(){return Err("registered root only; no caller URLs".into());}
    Ok((route,body))
}
fn main()->Result<(),Box<dyn std::error::Error>> {
    let args:Vec<_>=std::env::args().collect();if args.len()!=3{return Err("expected registered-root ready-file".into());}
    let root=std::fs::canonicalize(&args[1])?;let key=std::env::var("IMPECCABLE_CAPTURE_CAPABILITY")?;
    if key.len()<32{return Err("capability too short".into());}
    let listener=TcpListener::bind("127.0.0.1:0")?;listener.set_nonblocking(true)?;
    std::fs::write(&args[2],serde_json::to_vec(&json!({"port":listener.local_addr()?.port(),"root":root}))?)?;
    let started=Instant::now();let mut serial=0u64;let mut captures:HashMap<String,(Instant,Box<dyn CapturedEntry>)>=HashMap::new();
    while started.elapsed()<Duration::from_secs(180) {
        captures.retain(|_,(at,_)|at.elapsed()<Duration::from_secs(120));
        let (mut stream,_)=match listener.accept(){Ok(v)=>v,Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{std::thread::sleep(Duration::from_millis(10));continue;},Err(e)=>return Err(e.into())};
        stream.set_nonblocking(false)?;stream.set_read_timeout(Some(Duration::from_secs(5)))?;stream.set_write_timeout(Some(Duration::from_secs(10)))?;
        let answer=(||->Result<Value,String>{
            let (route,body)=request(&stream,&key)?;
            let text=|k:&str|body[k].as_str().ok_or_else(||format!("missing {k}"));
            match route.as_str() {
                "/capture"=>{
                    if captures.len()>=2{return Err("active capture limit".into());}
                    let stage=match text("stage")?{"hero"=>EntryStage::Hero,"responsive"=>EntryStage::Responsive,_=>return Err("invalid stage".into())};
                    let captured=CdpEntryRenderer.capture_entry(&EntryRequest{root:PathBuf::from(&root),artifact:text("entry")?.into(),spec:text("spec")?.into(),reference:text("reference")?.into(),stage})?;
                    let evidence=captured.evidence();
                    let frames:Vec<_>=evidence.frames.iter().map(|f|json!({"name":f.name,"png":base64::engine::general_purpose::STANDARD.encode(&f.png),"regions":f.regions.iter().map(|r|r.receipt.clone()).collect::<Vec<_>>()})).collect();
                    serial+=1;let handle=format!("capture-{serial}");let response=json!({"ok":true,"handle":handle,"report":evidence.report,"frames":frames});
                    if serde_json::to_vec(&response).map_err(|e|e.to_string())?.len()>64*1024*1024{return Err("response budget exceeded".into());}
                    captures.insert(handle,(Instant::now(),captured));Ok(response)
                },
                "/verify"=>{let (_,capture)=captures.get(text("handle")?).ok_or("unknown capture")?;capture.verify_current()?;Ok(json!({"ok":true}))},
                "/release"=>Ok(json!({"ok":captures.remove(text("handle")?).is_some()})),
                _=>Err("unknown operation".into())
            }
        })();
        let (status,body)=match answer{Ok(v)=>(200,v),Err(e)=>(400,json!({"ok":false,"error":e}))};
        let bytes=serde_json::to_vec(&body)?;let header=format!("HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",bytes.len());
        let _=stream.write_all(header.as_bytes()).and_then(|_|stream.write_all(&bytes));
    }
    Ok(())
}
