// Manda bytes «crudos» (ESC/POS) a una impresora por su nombre, saltándose el driver gráfico: el
// driver no los toca, la impresora los interpreta y usa su propia tipografía.
//
// En Windows se usa el spooler (winspool.drv: OpenPrinter / StartDocPrinter con tipo de datos RAW /
// WritePrinter) desde PowerShell, que ya viene con el sistema: no hace falta instalar nada ni compilar
// módulos nativos. En Linux y macOS se usa `lp -o raw` (sólo para desarrollo).
import { execFile } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { carpetaDatos } from '../rutas'

const ESPERA_MAXIMA_MS = 20_000

const SCRIPT_DE_WINDOWS = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DmCruda {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int escritos);
  public static void Enviar(string impresora, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero)) throw new Exception("No se pudo abrir la impresora «" + impresora + "» (error " + Marshal.GetLastWin32Error() + ").");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Ticket DM Gestion"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("La impresora no aceptó el trabajo (error " + Marshal.GetLastWin32Error() + ").");
      try {
        StartPagePrinter(h);
        int escritos;
        if (!WritePrinter(h, datos, datos.Length, out escritos) || escritos != datos.Length) throw new Exception("No se pudo escribir en la impresora (error " + Marshal.GetLastWin32Error() + ").");
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[DmCruda]::Enviar($env:DM_IMPRESORA, [System.IO.File]::ReadAllBytes($env:DM_ARCHIVO))
`

let trabajos = 0

function ejecutar(programa: string, argumentos: string[], entorno: Record<string, string>): Promise<void> {
  return new Promise((resolver, rechazar) => {
    execFile(
      programa,
      argumentos,
      { timeout: ESPERA_MAXIMA_MS, windowsHide: true, env: { ...process.env, ...entorno } },
      (error, _salida, errores) => {
        if (!error) return resolver()
        const detalle = (errores || '').toString().trim().split(/\r?\n/).find((l) => l.trim()) ?? ''
        rechazar(new Error(detalle || (error.killed ? 'La impresora no respondió a tiempo.' : error.message)))
      },
    )
  })
}

/** Manda `datos` a la impresora `impresora` tal cual, sin pasar por el driver gráfico. */
export async function enviarCrudoAImpresora(impresora: string, datos: Buffer): Promise<void> {
  const carpeta = path.join(carpetaDatos(), 'tickets')
  mkdirSync(carpeta, { recursive: true })
  const id = (trabajos = (trabajos + 1) % 1_000_000)
  const archivo = path.join(carpeta, `crudo-${id}.bin`)
  const script = path.join(carpeta, `crudo-${id}.ps1`)
  writeFileSync(archivo, datos)
  try {
    if (process.platform === 'win32') {
      // BOM: Windows PowerShell 5 lee los .ps1 sin BOM como ANSI y rompería las «» del mensaje de error.
      writeFileSync(script, '﻿' + SCRIPT_DE_WINDOWS, 'utf8')
      await ejecutar(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { DM_IMPRESORA: impresora, DM_ARCHIVO: archivo },
      )
    } else {
      await ejecutar('lp', ['-d', impresora, '-o', 'raw', archivo], {})
    }
  } finally {
    for (const f of [archivo, script]) {
      try {
        rmSync(f, { force: true })
      } catch {
        // Que no se pueda borrar un temporal no puede tumbar una impresión que ya salió.
      }
    }
  }
}
