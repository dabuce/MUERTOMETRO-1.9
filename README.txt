MUERTOMETRO

Muertometro es una PWA tactica para llevar el control de enemigos en partidas de Gloomhaven.
Permite gestionar vida, escudo, elite, dano acumulado y agrupacion de enemigos de forma rapida desde movil o escritorio.

Funciones principales
- Busqueda y autocompletado de enemigos.
- Alta rapida de enemigos con nivel y cantidad.
- Autorrelleno de estadisticas segun la biblioteca de monstruos.
- Control de vida, escudo y estado elite / normal.
- Danio rapido, danio acumulado, curacion y deshacer eliminacion.
- Agrupacion visual de enemigos del mismo tipo.
- Guardado local de la partida en el navegador.
- Funcionamiento como PWA instalable.
- Adaptacion a movil, escritorio y pantalla completa.

Estructura del proyecto
- index.html
- styles.css
- app.js
- manifest.json
- service-worker.js
- data/monsters.json
- assets/

Notas
- La biblioteca de monstruos se genero durante el desarrollo a partir de Gloomhaven Monster Stats.xlsx.
- La app no necesita leer el Excel durante el uso normal.
- El estado de la partida se guarda en el navegador.

Instalacion
1. Sube la carpeta completa a GitHub Pages o a cualquier servidor estatico.
2. Abre la URL en Chrome, Edge o un navegador compatible.
3. Para instalarla en Android, usa la opcion "Anadir a pantalla de inicio".
4. En escritorio, instala la PWA desde el navegador cuando aparezca la opcion.

Uso rapido
1. Abre la app.
2. Pulsa "Enemigos" para desplegar el formulario.
3. Busca un enemigo, elige nivel y cantidad.
4. Anade el enemigo y gestiona su vida desde su tarjeta.
