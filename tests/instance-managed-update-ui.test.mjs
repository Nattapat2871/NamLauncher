// Author/creator: nattapat2871 (https://nattapat2871.me)
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appTextSource = await readFile(new URL('../src/appText.ts', import.meta.url), 'utf8')

test('instance settings no longer expose the managed mod update workflow', () => {
  assert.doesNotMatch(appSource, /aria-labelledby="instance-managed-updates-title"/)
  assert.doesNotMatch(appSource, /requestInstanceManagedContentUpdate\(instanceSettingsTarget\)/)
  assert.doesNotMatch(appSource, /instanceSettingsUpdateSummary/)
})

test('bulk managed updates keep manual CurseForge files and continue with other items', () => {
  assert.match(appSource, /isCurseForgeManualDownloadRequired/)
  assert.match(appSource, /manualUpdates\.push\(update\)/)
  assert.match(appSource, /failedUpdates\.push\(update\)/)
  assert.match(appSource, /updates: \[\.\.\.blockedModUpdates, \.\.\.manualUpdates, \.\.\.failedUpdates\]/)
  assert.match(appTextSource, /NamLauncher keeps the existing file and reports that manual download is required/)
})

test('error report copy distinguishes automatic diagnostics from the manual developer report', () => {
  assert.match(appTextSource, /'launcherError\.submit\.send': 'ส่ง Error Report ให้ผู้พัฒนา'/)
  assert.match(appTextSource, /NamLauncher ส่งรายงานวิเคราะห์ที่ลดข้อมูลอ่อนไหวให้อัตโนมัติ ส่วนปุ่มด้านล่างใช้ส่งคำยืนยันของคุณให้ผู้พัฒนา/)
  assert.doesNotMatch(appTextSource, /ค่ะ|คะ/)
})

test('Microsoft login explains the expected missing Xbox profile setup', () => {
  assert.match(appSource, /Xbox Live rejected this Microsoft account\|has an Xbox profile\|allowed to use Xbox services\|finish profile or family-safety setup/)
  assert.match(appSource, /auth\.microsoft\.xboxProfileRequired/)
  assert.match(appSource, /auth\.microsoft\.failed/)
  assert.match(appTextSource, /Open the Xbox app or xbox\.com once, create or finish the Xbox profile/)
  assert.match(appTextSource, /เปิดแอป Xbox หรือ xbox\.com สักครั้ง/)
})
