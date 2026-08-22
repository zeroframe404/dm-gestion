// Genera el hash bcrypt de una contraseña, para la recuperación de emergencia de la base de usuarios
// compartida: si el único superadministrador olvidó la contraseña, el dueño del repositorio edita
// usuarios.json en github.com y pega acá el hash en "claveHash" (y pone "debeCambiarClave": true).
//
//   npm run clave-hash -- "la contraseña nueva"
import { hashSync } from 'bcryptjs'

const clave = process.argv[2]
if (!clave || clave.length < 8) {
  console.error('Uso: npm run clave-hash -- "<contraseña de al menos 8 caracteres>"')
  process.exit(1)
}
console.log(hashSync(clave, 10))
