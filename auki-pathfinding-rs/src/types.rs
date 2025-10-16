
#[derive(Debug, Clone, uniffi::Record)]
pub struct Vector3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct NavOptions {
    pub max_distance: Option<f32>,
    pub max_off_graph_distance: Option<f32>,
}

#[derive(Debug, Clone, Default, uniffi::Enum)]
pub enum EdgeDirection {
    #[default]
    Both = 0,
    Forward = 1,
    Backward = -1,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub dir: Option<EdgeDirection>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct Area {
    pub points: Vec<String>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct NavMap {
    pub points: std::collections::HashMap<String, Vector3>,
    pub edges: std::collections::HashMap<String, Edge>,
    pub areas: std::collections::HashMap<String, Area>,
}