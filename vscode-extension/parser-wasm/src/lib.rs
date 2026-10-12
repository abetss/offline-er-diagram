/// Allocate a byte buffer owned by the JavaScript bridge until `dbml_free` is called.
#[no_mangle]
pub extern "C" fn dbml_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0_u8; len].into_boxed_slice()) as *mut u8
}

/// # Safety
/// `ptr` and `len` must identify a live buffer returned by this module, freed exactly once.
#[no_mangle]
pub unsafe extern "C" fn dbml_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

/// Parse UTF-8 DBML. Return the JSON buffer's length in the high 32 bits and pointer in the low 32.
///
/// # Safety
/// `ptr` must point to `len` initialized UTF-8 bytes in a live `dbml_alloc` buffer.
/// The caller owns both buffers and must release each with `dbml_free`.
#[no_mangle]
pub unsafe extern "C" fn dbml_parse(ptr: *const u8, len: usize) -> u64 {
    let text = std::str::from_utf8(std::slice::from_raw_parts(ptr, len))
        .expect("JavaScript TextEncoder supplies UTF-8");
    let output = serde_json::to_vec(&parser_rs::parse_dbml(text))
        .expect("ParseResult serializes to JSON")
        .into_boxed_slice();
    let length = output.len() as u64;
    let pointer = Box::into_raw(output) as *mut u8 as u32;
    (length << 32) | u64::from(pointer)
}
