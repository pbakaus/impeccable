//! Bounded reads anchored to directory handles, including during renames.
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::Path;

pub(super) struct Reader(File);
impl Reader {
    pub(super) fn new(root: &Path) -> Option<Self> {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x02000000 | 0x00200000); // BACKUP_SEMANTICS, OPEN_REPARSE_POINT
        }
        let file = options.open(root).ok()?;
        plain(&file, true).then_some(Self(file))
    }
    pub(super) fn read(&self, sidecar: bool, cap: usize) -> Option<Vec<u8>> {
        // Each child is opened relative to an already opened directory, never
        // by reconstructing a pathname that an ancestor rename can redirect.
        let parent;
        let (dir, name) = if sidecar {
            parent = child(&self.0, ".impeccable", true)?;
            (&parent, "design.json")
        } else {
            (&self.0, "DESIGN.md")
        };
        let file = child(dir, name, false)?;
        if file.metadata().ok()?.len() > cap as u64 {
            return None;
        }
        let mut bytes = Vec::new();
        file.take((cap + 1) as u64).read_to_end(&mut bytes).ok()?;
        (bytes.len() <= cap).then_some(bytes)
    }
}

fn plain(file: &File, directory: bool) -> bool {
    let Ok(meta) = file.metadata() else {
        return false;
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return false;
        } // REPARSE_POINT
    }
    if directory {
        meta.is_dir()
    } else {
        meta.is_file()
    }
}

#[cfg(unix)]
fn child(dir: &File, name: &str, directory: bool) -> Option<File> {
    use std::os::fd::{AsRawFd, FromRawFd};
    let name = std::ffi::CString::new(name).ok()?;
    let flags = libc::O_RDONLY
        | libc::O_CLOEXEC
        | libc::O_NOFOLLOW
        | libc::O_NONBLOCK
        | if directory { libc::O_DIRECTORY } else { 0 };
    // SAFETY: dir is live; name is NUL terminated; no creation flag needs a mode.
    let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), flags) };
    if fd < 0 {
        return None;
    }
    // SAFETY: openat returned a newly owned descriptor.
    let file = unsafe { File::from_raw_fd(fd) };
    plain(&file, directory).then_some(file)
}

#[cfg(windows)]
fn child(dir: &File, name: &str, directory: bool) -> Option<File> {
    use std::ffi::c_void;
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    // NtOpenFile supplies the handle-relative open Windows' CreateFile lacks.
    // OPEN_REPARSE_POINT prevents following a replaced leaf; NON_DIRECTORY_FILE
    // plus the opened-handle metadata check refuses devices and pipes.
    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *mut u16,
    }
    #[repr(C)]
    struct ObjectAttributes {
        length: u32,
        root: *mut c_void,
        name: *mut UnicodeString,
        attributes: u32,
        security_descriptor: *mut c_void,
        security_quality_of_service: *mut c_void,
    }
    #[repr(C)]
    struct IoStatusBlock {
        status: usize,
        information: usize,
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn NtOpenFile(
            handle: *mut *mut c_void,
            access: u32,
            attributes: *mut ObjectAttributes,
            status: *mut IoStatusBlock,
            share: u32,
            options: u32,
        ) -> i32;
    }
    let mut wide: Vec<u16> = name.encode_utf16().collect();
    let length = u16::try_from(wide.len() * 2).ok()?;
    let mut unicode = UnicodeString {
        length,
        maximum_length: length,
        buffer: wide.as_mut_ptr(),
    };
    let mut attrs = ObjectAttributes {
        length: std::mem::size_of::<ObjectAttributes>() as u32,
        root: dir.as_raw_handle(),
        name: &mut unicode,
        attributes: 0x40, // CASE_INSENSITIVE
        security_descriptor: std::ptr::null_mut(),
        security_quality_of_service: std::ptr::null_mut(),
    };
    let mut handle = std::ptr::null_mut();
    let mut status = IoStatusBlock {
        status: 0,
        information: 0,
    };
    let options = 0x00200000 | 0x20 | if directory { 1 } else { 0x40 };
    // SAFETY: all structures and UTF-16 storage remain live for this synchronous
    // call; root is a live directory handle; NtOpenFile initializes handle.
    let result =
        unsafe { NtOpenFile(&mut handle, 0x00120089, &mut attrs, &mut status, 7, options) };
    if result < 0 || handle.is_null() {
        return None;
    }
    // SAFETY: a successful NtOpenFile returned a newly owned Windows handle.
    let file = unsafe { File::from_raw_handle(handle) };
    plain(&file, directory).then_some(file)
}

#[cfg(not(any(unix, windows)))]
fn child(_: &File, _: &str, _: bool) -> Option<File> {
    None
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    #[test]
    fn a_replaced_root_cannot_redirect_an_open_reader() {
        let root =
            std::env::temp_dir().join(format!("design-reader-{}", crate::oauth::random_b64(12)));
        std::fs::create_dir_all(root.join("repo")).unwrap();
        std::fs::create_dir_all(root.join("outside")).unwrap();
        std::fs::write(root.join("repo/DESIGN.md"), "# Original").unwrap();
        std::fs::write(root.join("outside/DESIGN.md"), "# Outside").unwrap();
        let reader = Reader::new(&root.join("repo")).unwrap();
        std::fs::rename(root.join("repo"), root.join("moved")).unwrap();
        symlink(root.join("outside"), root.join("repo")).unwrap();
        assert_eq!(reader.read(false, 100), Some(b"# Original".to_vec()));
        let leaf = root.join("moved/DESIGN.md");
        std::fs::remove_file(&leaf).unwrap();
        symlink(root.join("outside/DESIGN.md"), &leaf).unwrap();
        assert_eq!(reader.read(false, 100), None);
        std::fs::remove_file(&leaf).unwrap();
        use std::os::unix::ffi::OsStrExt;
        let fifo = std::ffi::CString::new(leaf.as_os_str().as_bytes()).unwrap();
        // SAFETY: fifo is a valid NUL-terminated pathname.
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        assert_eq!(reader.read(false, 100), None, "pipes must never block");
        std::fs::write(root.join("outside/design.json"), "outside").unwrap();
        symlink(root.join("outside"), root.join("moved/.impeccable")).unwrap();
        assert_eq!(
            reader.read(true, 100),
            None,
            "sidecar parents must not redirect"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
