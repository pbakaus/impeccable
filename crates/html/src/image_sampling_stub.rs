//! The sampled-contrast path (#560) without the image decoders: a build
//! with the `image-sampling` feature off (the wasm `detect` export, which
//! has no filesystem and could only ever sample data URIs) locates no
//! image, so every image-backed text keeps the skip it had before the path
//! existed. The API is the real module's.

pub use crate::image_url::{ground_label, layer_url};
pub use impeccable_detect::engines::ImageSamples;
use crate::background::{ImageLayer, LevelCache};
use crate::dom::StaticDocument;
use ego_tree::NodeId;
use impeccable_core::color::Rgba;
use std::path::Path;
use std::rc::Rc;

pub struct Samples {
    pub width: u32,
    pub height: u32,
    pub points: Vec<Rgba>,
}

pub struct ImageSource {
    pub width: u32,
    pub height: u32,
}

impl ImageSource {
    pub fn key(&self) -> &str {
        ""
    }
}

pub struct ImageSampler {
    mode: ImageSamples,
    levels: LevelCache,
}

impl ImageSampler {
    pub fn new(_html_dir: &str, mode: ImageSamples, _cache_dir: Option<&Path>) -> Self {
        ImageSampler {
            mode,
            levels: LevelCache::default(),
        }
    }

    pub fn levels(&self) -> &LevelCache {
        &self.levels
    }

    pub fn mode(&self) -> ImageSamples {
        self.mode
    }

    pub fn source(
        &self,
        _doc: &StaticDocument,
        _node: NodeId,
        _layer: &ImageLayer,
    ) -> Option<Rc<ImageSource>> {
        None
    }

    pub fn samples(
        &self,
        _doc: &StaticDocument,
        _node: NodeId,
        _layer: &ImageLayer,
        _source: &ImageSource,
    ) -> Option<Rc<Samples>> {
        None
    }

    pub fn decode_ahead(&self, _doc: &StaticDocument) {}
}
