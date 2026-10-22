//! 前端静态资源：编译期把 `dist-legacy` 打进二进制。

#[derive(rust_embed::RustEmbed)]
#[folder = "../dist-legacy"]
pub struct WebAssets;

pub fn get(path: &str) -> Option<rust_embed::EmbeddedFile> {
    WebAssets::get(path.trim_start_matches('/'))
}
