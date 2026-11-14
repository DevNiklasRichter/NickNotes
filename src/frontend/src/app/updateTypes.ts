export type UpdateState = {
  phase:'disabled'|'idle'|'checking'|'current'|'available'|'downloading'|'downloaded'|'installing'|'error'
  currentVersion:string
  version?:string
  /** Release notes of the offered version as `### Heading` / `- item` lines. */
  notes?:string
  percent?:number
  message:string
}
