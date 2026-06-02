use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub contract_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Running,
    Idle,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub id: String,
    pub project_id: String,
    pub status: AgentStatus,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub runtime_secs: u64,
    pub last_output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub source_path: String,
    pub item_type: String, // "skill" | "agent" | "mcp"
}

#[derive(Debug, Default)]
pub struct AppState {
    pub projects: RwLock<Vec<Project>>,
    #[allow(dead_code)]
    pub agents: RwLock<HashMap<String, AgentState>>,
    pub library: RwLock<Vec<SkillItem>>,
    pub claude_binary: RwLock<Option<String>>,
}

impl AppState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
}
