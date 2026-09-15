//! Offline HTTP client without filesystem/TLS configuration dependencies.
use std::{io::{Read,Write},net::TcpStream,time::Duration};
fn main()->Result<(),Box<dyn std::error::Error>>{
 let args:Vec<_>=std::env::args().collect();
 if args.len()!=5{return Err("port route capability body".into());}
 let port:u16=args[1].parse()?;
 let mut stream=TcpStream::connect(("127.0.0.1",port))?;
 stream.set_read_timeout(Some(Duration::from_secs(90)))?;
 let body=&args[4];
 write!(stream,"POST {} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Capture-Key: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",args[2],args[3],body.len(),body)?;
 let mut bytes=Vec::new();stream.take(64*1024*1024+8192).read_to_end(&mut bytes)?;
 let split=bytes.windows(4).position(|v|v==b"\r\n\r\n").ok_or("invalid HTTP")?;
 std::io::stdout().write_all(&bytes[split+4..])?;Ok(())
}
