// ALL claude.ai API paths live here. Confirmed on a real account by diagnostics (v0.5.1) unless marked otherwise.
export const EP = {
  conversations: (org, { limit = 50, offset = 0 } = {}) =>
    `/organizations/${org}/chat_conversations?limit=${limit}&offset=${offset}`,
  conversation: (org, id) =>
    `/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`,
  projects: (org) => `/organizations/${org}/projects`,
  project: (org, pid) => `/organizations/${org}/projects/${pid}`,
  projectDocs: (org, pid) => `/organizations/${org}/projects/${pid}/docs`, // text knowledge: [{file_name, content}]
  projectFiles: (org, pid) => `/organizations/${org}/projects/${pid}/files`, // binary knowledge: [{file_name, document_asset.url, ...}]
  // The "Artifacts" page: {artifacts:[{uuid, artifact_identifier, title, chat_conversation_uuid, ...}], next_cursor}
  userArtifacts: (org, { limit = 50, offset = 0 } = {}) =>
    `/organizations/${org}/user_artifacts?include_latest_published_artifact_uuid=true&limit=${limit}&offset=${offset}`,
  userArtifactsCount: (org) => `/organizations/${org}/user_artifacts/count`,
  memory: (org) => `/organizations/${org}/memory`, // {memory: string, controls, updated_at, ...}
  memorySettings: (org) => `/organizations/${org}/memory/settings`,
  skills: (org) => `/organizations/${org}/skills/list-skills`, // {skills:[{id,name,description,enabled,source,...}]}
  skillDownload: null, // unknown yet
};
