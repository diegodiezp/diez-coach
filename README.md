# diez coach

Ensayador generativo para ferias y visitas. Claude hace de visitante, inventa las preguntas en vivo, puntúa cada respuesta sobre 100, guarda el progreso de cada persona y aprende de lo que le das.

## Pestañas
- **Study**: pregunta nueva cada vez, con chuleta. Adaptativo: salen más los perfiles y criterios donde flojeas. Mirar la chuleta queda registrado.
- **Rehearse**: conversación en vivo con un perfil.
- **Exam**: 8 visitantes, sin chuleta, nota al final. La cifra que cuenta.
- **Progress**: medias, exámenes, evolución semanal, puntos débiles, informe copiable. Los admins ven a todo el equipo.
- **Dossier**: el briefing vigente.
- **Sources** (solo admins): el feeder.
  - Sube PDF, Word o texto, o pega una nota. Claude extrae lo útil, quita datos personales y marca contradicciones.
  - Research: Claude busca en internet (prensa, exposiciones afines, Frieze, mercado). Cada lunes a las 7 lo hace solo.
  - Todo queda pendiente hasta que lo apruebas. Puedes editarlo antes.
  - Las respuestas con 85 o más se proponen como "house line".
  - Rebuild briefing: fusiona todo lo aprobado en un documento limpio que usa todo el coach.
  - Lo de internet es contexto: nunca corrige datos de la artista.

## Deploy en Vercel
1. Sube esta carpeta a GitHub e impórtala en Vercel (Framework: Other, sin build).
2. Environment Variables:
   - `ANTHROPIC_API_KEY`: de console.anthropic.com, con saldo y límite de gasto mensual.
   - `TEAM`: `Diego:codigo-diego,NombreAsistente:codigo-asistente`
   - `ADMINS`: `Diego`
   - `AIRTABLE_TOKEN`: token con `data.records:read` y `data.records:write` sobre la base de inventario.
   - `CRON_SECRET`: cualquier cadena larga (activa la búsqueda semanal).
   - Opcionales: `COACH_MODEL` (por defecto `claude-sonnet-5`), `AIRTABLE_BASE`, `AIRTABLE_TABLE` (Coach Log), `AIRTABLE_SOURCES` (Coach Sources).
3. Redeploy.

Tablas en Airtable (base de inventario): Coach Log `tblUMrtgTPggOg5he` y Coach Sources `tblbkhS1k6fXWiN5Z`.

Si Vercel rechaza los `maxDuration` de `vercel.json` en tu plan, bájalos a 60.

## Otros artistas o proyectos
Duplica `data/jessica-wilson.json`, añádelo a `data/index.json` y abre `/?d=nombre`. Luego aliméntalo desde Sources.
