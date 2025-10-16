// src/geometry.rs
use crate::types::Vector3;

pub fn distance(a: &Vector3, b: &Vector3) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    (dx * dx + dy * dy + dz * dz).sqrt()
}

pub fn normalize(v: &Vector3) -> Vector3 {
    let len = distance(v, &Vector3 { x: 0.0, y: 0.0, z: 0.0 });
    Vector3 {
        x: v.x / len,
        y: v.y / len,
        z: v.z / len,
    }
}

// Port other geometry functions...