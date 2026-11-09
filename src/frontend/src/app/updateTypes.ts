export type UpdateState = {
  phase:'disabled'|'idle'|'checking'|'current'|'available'|'downloading'|'downloaded'|'installing'|'error'
  currentVersion:string
  version?:string
  percent?:number
  message:string
}
