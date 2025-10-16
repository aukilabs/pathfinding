// src/lib.rs
uniffi::setup_scaffolding!();

pub mod types;
pub mod geometry;
pub mod pathfinder;

use types::*;
use pathfinder::Pathfinder;

#[uniffi::export]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[uniffi::export]
pub fn create_pathfinder(config: NavOptions) -> Pathfinder {
    Pathfinder::new(config)
}

#[uniffi::export]
pub fn calculate_distance(a: Vector3, b: Vector3) -> f32 {
    geometry::distance(&a, &b)
}