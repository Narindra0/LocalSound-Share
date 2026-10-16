# Lecture seule des titres publiés dans les commandes multimédias Windows.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IRandomAccessStream'
    } | Select-Object -First 1
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await-Media($operation, $resultType) {
        $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
        if (-not $task.Wait(3000)) { throw 'Media query timed out' }
        return $task.Result
    }
    $manager = Await-Media ($managerType::RequestAsync()) $managerType
    $covers = @{}
    while ($true) {
        $items = @()
        $artBudget = 3000000
        foreach ($session in $manager.GetSessions()) {
            try {
                $properties = Await-Media ($session.TryGetMediaPropertiesAsync()) $propertiesType
                if ($properties.AlbumTitle -eq 'LocalSound Share / Live') { continue }
                if ($properties.Title) {
                    $key = $session.SourceAppUserModelId + '|' + $properties.Title + '|' + $properties.Artist
                    if (-not $covers.ContainsKey($key) -or -not $covers[$key]) {
                        $cover = $null
                        if ($properties.Thumbnail) {
                            $imageStream = $null; $reader = $null
                            try {
                                $imageStream = Await-Media ($properties.Thumbnail.OpenReadAsync()) $streamType
                                # OpenReadAsync renvoie un __ComObject : ses propriétés WinRT
                                # ne sont pas exposées directement à PowerShell.
                                $reader = $asStream.Invoke($null, @($imageStream))
                                if ($reader.Length -gt 0 -and $reader.Length -le 2097152) {
                                    $bytes = New-Object byte[] $reader.Length
                                    $offset = 0
                                    while ($offset -lt $bytes.Length) {
                                        $read = $reader.Read($bytes, $offset, $bytes.Length - $offset)
                                        if ($read -eq 0) { break }
                                        $offset += $read
                                    }
                                    if ($offset -eq $bytes.Length) { $cover = [Convert]::ToBase64String($bytes) }
                                }
                            } catch { } finally {
                                if ($reader) { try { $reader.Dispose() } catch { } }
                                if ($imageStream) { try { $imageStream.Dispose() } catch { } }
                            }
                        }
                        if ($covers.Count -ge 12) { $covers.Clear() }
                        $covers[$key] = $cover
                    }
                    $art = $covers[$key]
                    if ($art -and $art.Length -gt $artBudget) { $art = $null }
                    if ($art) { $artBudget -= $art.Length }
                    $items += @{ title = $properties.Title; artist = $properties.Artist; appId = $session.SourceAppUserModelId; playing = ($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing'); artworkBase64 = $art }
                }
            } catch { }
        }
        @{ available = $true; sessions = @($items) } | ConvertTo-Json -Depth 3 -Compress | ForEach-Object { [Console]::WriteLine($_) }
        Start-Sleep -Milliseconds 1500
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    [Console]::WriteLine('{"available":false,"sessions":[]}')
    exit 1
}
