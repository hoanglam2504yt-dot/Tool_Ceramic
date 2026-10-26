' Ceramic.vbs - Tu dong mo Adobe Illustrator neu chua chay, roi chay JSX

Dim appRef
Dim aiExe
Dim oShell

aiExe = "C:\Program Files\Adobe\Adobe Illustrator 2024\Support Files\Contents\Windows\Illustrator.exe"
Set oShell = CreateObject("WScript.Shell")

' Thu ket noi voi Illustrator dang chay san
On Error Resume Next
Set appRef = GetObject(, "Illustrator.Application")
On Error GoTo 0

' Neu Illustrator chua mo thi mo len va cho khoi dong xong
If IsEmpty(appRef) Or IsNull(appRef) Then
    oShell.Run """" & aiExe & """"
    WScript.Sleep 6000  ' Cho AI khoi dong (6 giay)

    Dim tries
    tries = 0
    Do While tries < 10
        On Error Resume Next
        Set appRef = GetObject(, "Illustrator.Application")
        On Error GoTo 0
        If Not (IsEmpty(appRef) Or IsNull(appRef)) Then Exit Do
        WScript.Sleep 2000  ' Thu lai sau moi 2 giay
        tries = tries + 1
    Loop
End If

If IsEmpty(appRef) Or IsNull(appRef) Then
    MsgBox "Khong the ket noi voi Adobe Illustrator. Vui long mo Illustrator thu cong roi chay lai.", vbCritical, "Loi"
    WScript.Quit 1
End If

' Chay file JSX
appRef.DoJavaScriptFile "L:\Ceramic\Tool_Ceramic\Ceramic.jsx"
