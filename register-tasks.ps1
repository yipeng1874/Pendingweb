$action = New-ScheduledTaskAction -Execute "D:\Pendingweb\auto-backup.bat"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

$trigger1 = New-ScheduledTaskTrigger -Daily -At "22:00"
Register-ScheduledTask -TaskName "PendingWeb备份-22点" -Action $action -Trigger $trigger1 -Settings $settings -RunLevel Highest -Force
Write-Host "22点任务注册完成"

$trigger2 = New-ScheduledTaskTrigger -Daily -At "05:00"
Register-ScheduledTask -TaskName "PendingWeb备份-凌晨5点" -Action $action -Trigger $trigger2 -Settings $settings -RunLevel Highest -Force
Write-Host "凌晨5点任务注册完成"
