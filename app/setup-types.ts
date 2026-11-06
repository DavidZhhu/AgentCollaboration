export type SetupAgent = {
    id: string;
    name: string;
    role: string;
    provider: string;
    worker_seen: number | null;
    worker_status: string;
    worker_error: string;
    worker_id: string | null;
    project_name: string;
    repo: string;
};
export type SetupCheck = {
    agent_id: string;
    nonce: string;
    status: string;
    summary: string;
    created_at: number;
    completed_at: number | null;
};
export type SetupData = {
    agents: SetupAgent[];
    checks: SetupCheck[];
    user: string;
    owner: boolean;
};
export type SetupGrant = {
    code_hash: string;
    agent_id: string;
    provider: string;
    session_mode: string;
    session_id: string;
    folder: string;
    clone_repo: number;
    repo: string;
};
