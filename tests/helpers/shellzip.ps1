param([string[]]$Paths)
$shell = New-Object -ComObject Shell.Application
foreach ($p in $Paths) {
  $ns = $shell.NameSpace($p)
  if ($null -eq $ns) { "{0} -> NameSpace = NULL (Explorer cannot open)" -f (Split-Path $p -Leaf); continue }
  $n = 0
  try { $n = $ns.Items().Count } catch { "{0} -> Items() threw: {1}" -f (Split-Path $p -Leaf), $_.Exception.Message; continue }
  "{0} -> opens, {1} top-level items" -f (Split-Path $p -Leaf), $n
}
