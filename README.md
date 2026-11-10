# GVHidra for VSCode

GVHidra for VSCode es una extensión de Visual Studio Code ideada para apoyar los desarrollos **gvHidra en entornos de la Generalitat Valenciana (GVA)**. Se asume que se utiliza el entorno **gvhidradev dentro de WSL**, con el proyecto abierto en una ventana de VS Code conectada a esa distribución.

La extensión reúne en un panel herramientas de control de versiones, integración con Codex, corrección de código PHP, configuración de Xdebug 3, control de contenedores Docker y accesos a documentación y servicios del entorno.

## Entorno de trabajo

- Visual Studio Code 1.100.0 o posterior, conectado a WSL y con la extensión instalada en ese entorno.
- Entorno gvhidradev, con los proyectos bajo `~/gvhidra/gvhidradev/htdocs/`.
- Git o Subversion disponibles en WSL, según el repositorio del proyecto.
- Para corregir código: PHP y PHP CS Fixer disponibles en el entorno de ejecución de la extensión.
- Para depurar: Xdebug 3 configurado en el servidor PHP y un adaptador de depuración PHP instalado en VS Code.
- Para gestionar los contenedores: Docker con el comando `docker compose` disponible en WSL y acceso al servicio de Docker.
- Para la sección Codex: la extensión OpenAI ChatGPT (`openai.chatgpt`) con su ejecutable de Codex accesible, y acceso al repositorio de plugins de Laberit.

Cada herramienta requiere sus propias dependencias y los permisos de acceso a los repositorios o servicios que se utilicen.

## Acceso al panel

1. Abre el proyecto de gvhidradev desde una ventana de VS Code conectada a WSL.
2. Pulsa el icono **GVHidra** de la barra de actividad.
3. Despliega la sección de la herramienta que quieras utilizar.

### Directorio de trabajo

El campo **Directorio de trabajo**, situado encima de las secciones, muestra la carpeta del proyecto y es de solo lectura. Si hay varias carpetas abiertas, toma la que contiene el fichero del editor activo; en su defecto, utiliza la primera carpeta del espacio de trabajo.

## Version control

Detecta si el proyecto utiliza Git o SVN y muestra los controles correspondientes. El estado de la sección indica **Git active**, **SVN active** o **Not detected**. En SVN también puede detectar una copia de trabajo anidada a partir del fichero activo o cuando existe una única copia dentro de las carpetas abiertas.

### Sin repositorio detectado

| Elemento | Funcionalidad |
| --- | --- |
| **URL Repositorio** | Permite introducir la URL del proyecto que se quiere descargar. |
| **SVN checkout** | Solicita el nombre del nuevo proyecto y sus credenciales SVN, descarga la URL indicada y abre la carpeta al finalizar correctamente. |
| **GIT clone** | Solicita el nombre del nuevo proyecto, clona la URL indicada y abre la carpeta al finalizar correctamente. |

Las descargas se crean en `~/gvhidra/gvhidradev/htdocs/<nombre-del-proyecto>`. Debe haber una carpeta abierta en VS Code para iniciar la operación; el destino es una carpeta nueva y el nombre solicitado no puede corresponder a una carpeta existente.

### Proyecto Git

| Elemento | Funcionalidad |
| --- | --- |
| **URL Repositorio** | Muestra inicialmente la URL de `origin`. Permite elegir otra URL, que se recuerda por proyecto al utilizarla en una acción. |
| **Clonar desde URL** | Descarga la URL en un nuevo proyecto de `htdocs` y lo abre cuando termina. |
| **Crear tag desde URL** | Solicita el nombre, la rama o tag de origen y el comentario; crea un tag anotado y lo publica en la URL indicada. |
| **Update desde URL** | Actualiza la rama actual desde la misma rama de la URL indicada mediante un avance rápido (`fast-forward`). Se detiene si la actualización requiere una fusión. |
| **Cambiar rama** | Obtiene la rama solicitada desde la URL indicada. Si ya existe localmente, cambia a ella e intenta actualizarla mediante un avance rápido; si no, la crea desde la referencia descargada. |
| **Ir a pipeline del proyecto** | Abre en el navegador la página de pipelines de GitLab correspondiente a la URL del repositorio. |
| **Abrir Source Control** | Abre la vista de control de código fuente de VS Code. |

Las operaciones de descarga y los comandos Git muestran su ejecución en terminales de VS Code.

### Proyecto SVN

| Elemento | Funcionalidad |
| --- | --- |
| **URL Repositorio** | Muestra la URL de la copia de trabajo, o la última URL guardada si no puede consultarla. Permite indicar la URL que utilizarán las acciones. |
| **Checkout de la URL** | Solicita un nombre de proyecto y credenciales, descarga la URL en una carpeta nueva de `htdocs` y la abre al finalizar correctamente. |
| **Crear tag desde URL** | Solicita un nombre de tag, una URL de destino y un comentario; crea el tag mediante una copia remota de la URL de origen. |
| **Update desde URL** | Actualiza la copia de trabajo desde la URL indicada mediante `svn switch`, permitiendo cambiar la rama o ruta del repositorio asociada. |
| **Commit desde URL** | Comprueba que la copia de trabajo corresponde a la URL indicada, solicita un comentario y publica sus cambios mediante `svn commit`. |
| **Gestionar credenciales del proyecto** | Solicita y guarda el usuario y la contraseña SVN del proyecto identificado por el directorio de trabajo, que debe estar bajo `htdocs`. |
| **Resetear credenciales globales** | Solicita confirmación y elimina el contenido de `~/.subversion/auth`, incluidas las credenciales guardadas para otros repositorios del usuario. |
| **Mostrar historial del fichero activo** | Muestra en una terminal el historial SVN del fichero abierto, siempre que pertenezca a la copia de trabajo detectada. |
| **Abrir Source Control** | Abre la vista de control de código fuente de VS Code. |

Las credenciales del proyecto se guardan en `~/.subversion/auth/<ruta-del-proyecto-bajo-htdocs>/svn-credentials`, sin cifrar y con permisos de lectura y escritura para el propietario (`0600`). Las acciones SVN las reutilizan; si no están disponibles, los comandos de actualización, commit, creación de tags e historial permiten introducirlas en la terminal.

## Codex

Localiza el ejecutable de Codex incluido en la extensión OpenAI ChatGPT y muestra su versión. Si no encuentra el ejecutable, indica **No disponible**.

| Elemento | Funcionalidad |
| --- | --- |
| **Instalar am-marketplace** | Registra el marketplace de plugins de Laberit desde `https://gitlab.laberit.com/am/ia/plugins/am-marketplace/codex.git`, utilizando la rama `main`. Si Git necesita autenticación, solicita el usuario y la contraseña o token de GitLab (oculto) y reintenta la instalación. Las credenciales introducidas se utilizan solo durante esa instalación. |
| **Instalar skills del am-marketplace** | Consulta los plugins disponibles en `am-marketplace`, muestra un selector e instala el elemento elegido mediante Codex. Requiere haber registrado el marketplace. |

## PHP CS Fixer

Permite generar la configuración de estilo y ejecutar PHP CS Fixer sobre el proyecto. Busca el ejecutable primero en `vendor/bin/php-cs-fixer`, después en las ubicaciones de Composer global y finalmente en `PATH`. Si no lo encuentra, muestra **No disponible** y mantiene el botón para crear la configuración.

| Elemento | Funcionalidad |
| --- | --- |
| **Fix selected file** | Guarda y corrige el fichero PHP del editor activo, siempre que esté en disco y pertenezca al directorio de trabajo. |
| **Fix project** | Guarda los documentos abiertos y ejecuta la corrección sobre el proyecto completo, respetando su configuración. |
| **Crear fichero configuración** | Crea `.php-cs-fixer.php` en el directorio de trabajo si todavía no existe. |

Las acciones de corrección requieren `.php-cs-fixer.php` y muestran la salida en una terminal de tareas. La configuración inicial parte de PSR-12, añade reglas de formato y excluye los directorios `igep`, `templates_c`, `vendor`, `node_modules` y `.git`.

## XDebug3

Ofrece accesos para preparar la configuración de depuración PHP del proyecto e iniciar el depurador de VS Code.

| Elemento | Funcionalidad |
| --- | --- |
| **Iniciar Debug** | Ejecuta la acción de iniciar depuración de VS Code con la configuración seleccionada. |
| **Reconfigurar XDebug3** | Crea `.vscode/launch.json` en el directorio de trabajo y solicita confirmación si el fichero ya existe. |

El directorio del proyecto debe estar bajo `htdocs`. La configuración relaciona `/var/www/htdocs/<proyecto>` del servidor con `${workspaceFolder}` y utiliza el puerto `9003`. Genera dos opciones:

- **Listen for Xdebug**: espera una conexión sin detenerse automáticamente en la primera línea.
- **Xdebug every line**: espera una conexión y se detiene al entrar en el programa.

Ambas opciones habilitan el registro de depuración e ignoran los ficheros PHP de `vendor`.

## Docker Container

Controla los contenedores del entorno desde una sección con el icono de la ballena de Docker. Ambas acciones se ejecutan en `~/gvhidra/gvhidradev`, independientemente del proyecto abierto, y muestran el comando y su salida en la terminal de tareas de VS Code.

| Elemento | Funcionalidad |
| --- | --- |
| **Levantar Contenedores** | Ejecuta `docker compose up -d`. |
| **Bajar Contenedores** | Ejecuta `docker compose down`. |

Si el directorio no existe o no se puede iniciar la tarea, se muestra un mensaje de error. Los errores de Docker Compose se muestran en la terminal de la tarea.

## Documentation

Reúne accesos que se abren en el navegador.

| Elemento | Funcionalidad |
| --- | --- |
| **Manual** | Abre la URL definida en `gvhidra.documentation.manualUrl`. |
| **Wiki** | Abre la URL definida en `gvhidra.documentation.wikiUrl`. |
| **Confluence** | Abre la página «¿Qué es gvHIDRA?» del espacio gvHIDRA en Confluence de la GVA. |
| **Nexus** | Abre el repositorio de artefactos gvHIDRA en Nexus de la GVA. |
| **Jenkins** | Abre el servidor Jenkins de la GVA. |
| **Web Oficial** | Abre el apartado de descargas de la web oficial de gvHIDRA. |

Las direcciones de **Manual** y **Wiki** se pueden ajustar en la configuración de VS Code buscando sus identificadores. Sus valores predeterminados son `https://example.com/manual` y `https://example.com/wiki`; deben sustituirse por las direcciones del entorno que se vaya a utilizar. El acceso a los servicios depende de la conectividad y los permisos del usuario.

## Desarrollo y empaquetado

Las novedades de la versión `0.0.2` se registran en [CHANGELOG.md](CHANGELOG.md).

Para compilar y empaquetar la extensión se necesita Node.js 22 o posterior y npm. Las pruebas de control de versiones utilizan `git`, `svn` y `svnadmin`.

```bash
npm ci
npm test
npm run package:ls
npm run package
```

`package:ls` permite revisar los archivos que se incluirán. `package` limpia la compilación anterior, compila automáticamente la extensión y genera `gvhidra-vscode-0.0.1.vsix` en la raíz del repositorio. El paquete incluye el código compilado, los iconos, este README, el changelog y la licencia; excluye las fuentes TypeScript, las pruebas y las dependencias de desarrollo. La extensión no utiliza dependencias de ejecución de npm, por lo que el empaquetado omite su búsqueda.

El VSIX se puede instalar desde **Extensions: Install from VSIX...** o con:

```bash
code --install-extension ./gvhidra-vscode-0.0.1.vsix
```

## Licencia

Distribuida bajo la licencia [MIT](LICENSE).
