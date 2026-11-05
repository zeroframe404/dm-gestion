# Cobertia — Versión de demostración

Sistema de gestión para agencias y productores de seguros: cartera, cobranzas, caja, renovaciones,
siniestros, leads, presupuestos, multicotizador con las compañías, mensajería interna, métricas y reportes.

> **Esto es una DEMO.** Todo lo que ves son **datos inventados** y el programa **no se conecta a internet**:
> ni a un servidor, ni a las compañías, ni a redes sociales. Cada vez que lo abrís vuelve a empezar con los
> mismos datos de ejemplo, así que podés tocar, cargar y borrar sin miedo.

## Instalación y acceso

1. Bajá `Cobertia-Demo-Setup-….exe` de la sección **Releases** y ejecutalo.
   Windows puede mostrar «Windows protegió su PC» porque el instalador no está firmado: tocá
   **Más información → Ejecutar de todas formas**.
2. Abrí **Cobertia (Demo)** desde el escritorio o el menú Inicio.
3. Ingresá con:

   | Usuario | Contraseña |
   |---|---|
   | `test` | `admin` |

   En la pantalla de ingreso también hay botones para entrar como otros usuarios de ejemplo (encargado,
   empleados de mostrador, productor): todos usan la contraseña `admin` y sirven para ver cómo cambia el
   programa según el rol de quien entra.

Se reconoce que es la demo por la **franja verde de arriba**, la insignia **DEMO** y el nombre «Seguros Demo»
en lugar del de una agencia real.

---

## Cómo está armado el programa: Local, VPS y APIs

El programa de verdad trabaja en **tres capas**. En la demo, las tres están simuladas adentro de la misma
computadora; cuando una agencia lo pone en marcha, cada una se configura por separado.

```
   ┌──────────── PC de cada empleado ────────────┐
   │  Cobertia  ──  base local (SQLite)          │   ← LOCAL
   └───────┬──────────────────────────┬──────────┘
           │ HTTPS + token            │ HTTPS (credenciales de cada compañía)
           ▼                          ▼
   ┌──── VPS de la agencia ────┐   ┌──── APIs ─────────────────────────┐
   │ base compartida (Postgres)│   │ ATM · Mercantil · Equidad         │
   │ usuarios · ajustes · chat │──▶│ Galeno (por IP fija del VPS)      │
   │ adjuntos · respaldos      │   │ Meta · TikTok · Google            │
   └───────────────────────────┘   └───────────────────────────────────┘
          ← VPS                              ← API
```

### 1. Local (cada computadora)

Es lo que vive en la PC de cada empleado, en la carpeta de datos del programa (`%APPDATA%`).

| Qué | Para qué |
|---|---|
| Base de datos SQLite | Una copia de trabajo de la cartera: clientes, pólizas, planillas, caja, siniestros. Las pantallas leen de acá, por eso es rápido. |
| Credencial del último ingreso | Cifrada por Windows. Permite **entrar sin internet hasta 30 días**. Nunca guarda la contraseña, sólo un hash. |
| `config.json` | La dirección y el token del VPS, y las cuentas de las APIs que se cargaron en esa PC. **No se comparte ni se sube a ningún lado.** |
| Adjuntos, informes, respaldos | Copias locales de documentos de pólizas/siniestros, informes de importación y respaldos `.xlsx`. |

**Sin VPS** el programa funciona igual en una sola computadora: todo queda local. **Con VPS**, sin internet se
puede **mirar** todo pero no escribir, para que dos PCs no se pisen.

### 2. VPS (el servidor de la agencia)

Cada agencia tiene **su propio servidor** (un VPS Linux con dominio y HTTPS). Es lo que hace que varias
computadoras y sucursales trabajen sobre **la misma base**.

| Qué guarda / hace el VPS | Detalle |
|---|---|
| Base compartida (PostgreSQL) | La cartera de la agencia. Cada PC sube sus cambios y baja los de las demás. |
| Usuarios y permisos | Quién entra, con qué rol y en qué sucursal. Se administra en **Administración → Usuarios / Permisos**. |
| Ajustes compartidos | Lo que se carga una vez y lo tienen todas las PCs: cuentas de las compañías, Meta, encabezado del ticket. |
| Canal en vivo | Chat interno, presencia («quién está conectado»), reacciones y llamadas de voz. |
| Adjuntos y respaldos | El archivo original de cada documento y un respaldo diario. |
| Puente a Galeno | Galeno exige una **IP fija** autorizada: el pedido sale desde el VPS, no desde cada PC. |

**Qué hace falta para ponerlo en marcha:**

1. Un VPS con dominio propio y certificado HTTPS (por ejemplo `https://gestion.suagencia.com.ar`).
2. Instalar el servidor del programa y fijar en su `.env` el **token de sincronización** (una clave larga
   compartida entre el servidor y las PCs) y la **clave de cifrado de ajustes**.
3. En el programa: **Administración → Servidor (VPS)** → dirección + token → **Probar conexión**. La pantalla
   arma el bloque `vps` del `config.json`.
4. Una sola vez, desde una PC: subir los usuarios y migrar la base al servidor.

> En la demo, **Administración → Servidor (VPS)** muestra todo esto con un formulario de prueba: el «Probar
> conexión» está simulado (no sale a internet) y sirve para ver cómo se configura.

### 3. APIs (compañías y servicios externos)

Las APIs son las conexiones con **sistemas de terceros**. Cada agencia usa **sus propias credenciales**, que
le da cada compañía al productor. Se cargan en **API Aseguradoras** (o **Redes sociales**) y viajan a las
demás PCs como ajuste compartido a través del VPS.

| Servicio | Qué hace en el programa | Qué hay que pedirle a la compañía | Por dónde sale |
|---|---|---|---|
| **Galeno** | Cotiza **y emite** autos; trae novedades de cartera. | Usuario/clave de servicios REST y autorizar la IP del VPS. | Desde el **VPS** (IP fija) |
| **ATM Seguros** | Cotiza autos y motos. | Usuario, clave y código de vendedor; acceso al FTP de tablas. | Directo desde cada PC |
| **Mercantil Andina** | Cotiza autos (se emite en su web con el número de cotización). | Usuario, contraseña y *subscription key* del portal de APIs. | Directo desde cada PC |
| **La Equidad** | Cotiza autos (API GLM). | URL base, usuario de aplicación y contraseña. | Directo desde cada PC |
| **Meta** (Facebook / Instagram / WhatsApp) | Publicar, leer métricas, avisos por WhatsApp. | Una app de Meta y su dirección de vuelta. | Directo desde cada PC |
| **TikTok** | Métricas y publicaciones. | Una app de TikTok for Developers. | Directo desde cada PC |
| **Google** (Sheets / Drive) | Migración inicial desde una planilla y copia de respaldos en Drive. Opcional. | Una cuenta de servicio de Google. | Directo desde cada PC |

El **multicotizador** consulta a todas las compañías configuradas **a la vez**, compara por tipo de cobertura
y marca la más barata; con las coberturas elegidas arma un presupuesto en PDF.

> En la demo, **todas** estas APIs responden desde adentro del programa con precios y números de póliza
> inventados (pero coherentes: cambian según el vehículo, la zona y la forma de pago). Ninguna sale a internet.

---

## Resumen: qué va en cada cosa

| | Local (PC) | VPS (servidor) | API (terceros) |
|---|---|---|---|
| Dónde vive | `%APPDATA%` de cada PC | El servidor de la agencia | Los sistemas de cada compañía / red |
| Qué tiene | Copia de trabajo, credencial offline, `config.json` | La base real, usuarios, ajustes, chat, adjuntos | Cotizaciones, emisión, catálogos, métricas |
| Quién lo configura | Se arma solo al instalar | La agencia (una vez) | La agencia, con las credenciales que le dan |
| Sin internet | Funciona (mira; escribe si no hay VPS) | — | No disponible |
| **En esta demo** | Real, pero se borra al abrir | **Simulado** en la misma PC (127.0.0.1) | **Simuladas**, sin red |

## Preguntas frecuentes

- **¿Lo que cargo en la demo se guarda?** No. Al cerrar y volver a abrir, arranca de nuevo con los datos de ejemplo.
- **¿Puedo probarlo sin internet?** Sí: la demo no usa internet para nada.
- **¿Se actualiza solo?** La demo no. La versión de una agencia sí se actualiza sola.
- **¿Cómo paso de la demo al programa real?** Se instala la versión de la agencia, se configura su VPS y se
  cargan sus cuentas de las compañías. Los datos se migran desde su planilla actual.
