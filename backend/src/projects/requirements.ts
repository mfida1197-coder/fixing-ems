export type RequirementVersionRow = {
  requirement_id: number; project_id: number; client_id: number; current_version: number;
  requirement_created_at: string; requirement_updated_at: string; client_name?: string;
  version_number: number; content: string; version_created_at: string;
  attachment_name?: string | null;
};

export function groupRequirementRows(rows: RequirementVersionRow[]) {
  const grouped = new Map<number, any>();
  for (const row of rows) {
    if (!grouped.has(Number(row.requirement_id))) {
      grouped.set(Number(row.requirement_id), {
        id: Number(row.requirement_id), project_id: Number(row.project_id), client_id: Number(row.client_id),
        client_name: row.client_name, current_version: Number(row.current_version),
        attachment_name: row.attachment_name ?? null,
        created_at: row.requirement_created_at, updated_at: row.requirement_updated_at, versions: [],
      });
    }
    grouped.get(Number(row.requirement_id)).versions.push({
      version_number: Number(row.version_number), content: row.content, created_at: row.version_created_at,
    });
  }
  return Array.from(grouped.values()).map((requirement) => ({ ...requirement, current: requirement.versions[0] ?? null }));
}
