let localCurrentPath = '';
let remoteCurrentPath = '/';
let term;
let sshConfig = null;
let fitAddon;
let fontSize = 14; // 默认字体大小
let isConnected = false; // 跟踪连接状态
let sshDataListener = null;

document.addEventListener('DOMContentLoaded', async () => {
    localCurrentPath = await window.sftp.getCurrentDirectory();
    initTerminal();
    await loadSavedConnections();
    loadLocalFiles(localCurrentPath);
    setupPathInputs();
    setupResizers();
    setupBackButtons();
    setupDesktopButton();
    setupContextMenu();
    setupDragAndDrop();  // 新添加
    setupSearch();  // 新添加

    document.getElementById('connect').addEventListener('click', () => {
        if (isConnected) {
            disconnect();
        } else {
            connect();
        }
    });
});

function initTerminal() {
    if (term) {
        term.dispose();
    }
    term = new Terminal({
        cursorBlink: true,
        theme: {
            background: '#000',
            foreground: '#fff'
        },
        allowTransparency: true,
        disableStdin: false,
        copyOnSelect: true,
        convertEol: true,
        wordSeparator: ' ()[]{}\',"`',
        fontSize: fontSize
    });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    // 添加右键菜单
    setupTerminalContextMenu();

    // 添加快捷键支持
    setupTerminalKeyboardShortcuts();
}

function setupTerminalContextMenu() {
    document.getElementById('terminal').addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="copy">复制</div>
            <div class="context-menu-item" data-action="paste">粘贴</div>
        `;
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        document.body.appendChild(menu);

        menu.addEventListener('click', (event) => {
            const action = event.target.getAttribute('data-action');
            if (action === 'copy') {
                document.execCommand('copy');
            } else if (action === 'paste') {
                navigator.clipboard.readText().then(text => {
                    term.paste(text);
                });
            }
            document.body.removeChild(menu);
        });

        document.addEventListener('click', () => {
            if (document.body.contains(menu)) {
                document.body.removeChild(menu);
            }
        }, {once: true});
    });
}

function setupTerminalKeyboardShortcuts() {
    term.attachCustomKeyEventHandler((event) => {
        if (event.ctrlKey && event.key === 'c' && term.hasSelection()) {
            document.execCommand('copy');
            return false;
        }
        if (event.ctrlKey && event.key === 'v') {
            navigator.clipboard.readText().then(text => {
                term.paste(text);
            });
            return false;
        }
        return true;
    });
}

async function connect() {
    if (isConnected) {
        term.writeln('已经连接，请先断开连接');
        return;
    }

    // 禁用连接按钮，防止重复点击
    document.getElementById('connect').disabled = true;

    const config = {
        name: document.getElementById('connection-name').value,
        host: document.getElementById('host').value,
        port: parseInt(document.getElementById('port').value),
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
    };

    try {
        // 确保之前的连接已经完全关闭
        await disconnect();

        // 重置 SFTP 和 SSH 客户端
        await window.sftp.resetClient();
        await window.ssh.resetClient();

        const result = await window.sftp.connect(config);
        if (result.success) {
            term.writeln('SFTP连接成功');
            loadRemoteFiles(remoteCurrentPath);
            await window.sftp.saveConnection(config);
            loadSavedConnections();

            const sshResult = await window.ssh.connect(config);
            if (sshResult.success) {
                term.writeln('SSH连接成功');
                sshConfig = config;
                initTerminal(); // 重新初始化终端
                setupSSHInput();
                isConnected = true;
                document.getElementById('connect').textContent = '断开';

                // 清理终端并等待一段时间
                term.clear();
                await new Promise(resolve => setTimeout(resolve, 500));

                // 发送一个换行符来触发提示符
                window.ssh.write('\n');
            } else {
                term.writeln(`SSH连接失败: ${sshResult.error}`);
                await window.sftp.disconnect();
                isConnected = false;
            }
        } else {
            term.writeln(`连接失败: ${result.error}`);
        }
    } catch (error) {
        term.writeln(`连接失败: ${error}`);
        isConnected = false;
    } finally {
        // 恢复连接按钮
        document.getElementById('connect').disabled = false;
    }
}

function setupSSHInput() {
    // 移除旧的监听器（如果存在）
    if (sshDataListener) {
        window.ssh.removeDataListener(sshDataListener);
    }

    // 添加新的监听器
    sshDataListener = (data) => {
        term.write(data);
    };

    window.ssh.onData(sshDataListener);

    // 移除旧的 onData 处理函数
    if (term._onDataHandler) {
        term.onData(null);
    }

    // 设置新的终端数据监听器
    term._onDataHandler = (data) => {
        if (isConnected) {
            window.ssh.write(data);
        }
    };
    term.onData(term._onDataHandler);
}

async function disconnect() {
    if (!isConnected) {
        return;
    }

    try {
        await window.sftp.disconnect();
        await window.ssh.disconnect();

        // 移除所有SSH数据监听器
        window.ssh.removeAllListeners();

        // 移除传输进度监听器
        window.sftp.removeTransferProgressListener();

        // 移除终端的 onData 监听器
        if (term && term._onDataHandler) {
            term.onData(null);
            term._onDataHandler = null;
        }

        term.writeln('已断开连接');
        isConnected = false;
        document.getElementById('connect').textContent = '连接';
        document.getElementById('remote-files').innerHTML = '';

        // 重置 SFTP 和 SSH 客户端
        await window.sftp.resetClient();
        await window.ssh.resetClient();

        // 重新初始化终端，这将清除所有旧的事件监听器
        initTerminal();
    } catch (error) {
        term.writeln(`断开连接失败: ${error}`);
    }
}

function setupPathInputs() {
    const localPathInput = document.getElementById('local-path');
    const remotePathInput = document.getElementById('remote-path');

    localPathInput.value = localCurrentPath;
    remotePathInput.value = remoteCurrentPath;

    localPathInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            localCurrentPath = localPathInput.value;
            await loadLocalFiles(localCurrentPath);
        }
    });

    remotePathInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            remoteCurrentPath = remotePathInput.value;
            await loadRemoteFiles(remoteCurrentPath);
        }
    });
}

function setupResizers() {
    const verticalResizer = document.getElementById('vertical-resizer');
    const horizontalResizer = document.getElementById('horizontal-resizer');
    const leftPane = document.querySelector('.file-list-container');
    const rightPane = document.querySelector('.file-list-container:last-child');
    const topPane = document.querySelector('.file-lists');
    const bottomPane = document.getElementById('terminal');

    let isResizing = false;
    let currentResizer = null;

    function handleResize(e) {
        if (!isResizing) return;

        if (currentResizer === verticalResizer) {
            const containerWidth = leftPane.parentElement.clientWidth;
            const percentage = (e.clientX / containerWidth) * 100;
            leftPane.style.width = `${percentage}%`;
            rightPane.style.width = `${100 - percentage}%`;
        } else if (currentResizer === horizontalResizer) {
            const containerHeight = topPane.parentElement.clientHeight;
            const percentage = (e.clientY / containerHeight) * 100;
            topPane.style.height = `${percentage}%`;
            bottomPane.style.height = `${100 - percentage}%`;
            if (fitAddon) {
                fitAddon.fit();
            }
        }
    }

    function startResize(e) {
        isResizing = true;
        currentResizer = e.target;
        document.addEventListener('mousemove', handleResize);
        document.addEventListener('mouseup', stopResize);
    }

    function stopResize() {
        isResizing = false;
        currentResizer = null;
        document.removeEventListener('mousemove', handleResize);
        document.removeEventListener('mouseup', stopResize);
    }

    verticalResizer.addEventListener('mousedown', startResize);
    horizontalResizer.addEventListener('mousedown', startResize);
}

function setupBackButtons() {
    document.getElementById('local-back').addEventListener('click', () => {
        const newPath = localCurrentPath.split('/').slice(0, -1).join('/') || '/';
        localCurrentPath = newPath;
        loadLocalFiles(newPath);
    });

    document.getElementById('remote-back').addEventListener('click', () => {
        const newPath = remoteCurrentPath.split('/').slice(0, -1).join('/') || '/';
        remoteCurrentPath = newPath;
        loadRemoteFiles(newPath);
    });
}

async function loadLocalFiles(path) {
    try {
        const files = await window.sftp.listLocal(path);
        displayFiles(files, 'local-files', path);
        document.getElementById('local-path').value = path;
    } catch (error) {
        term.writeln(`获取本地文件列表失败: ${error}`);
    }
}

async function loadRemoteFiles(path) {
    try {
        const result = await window.sftp.list(path);
        if (result.success) {
            displayFiles(result.files, 'remote-files', path);
            document.getElementById('remote-path').value = path;
        } else {
            term.writeln(`获取远程文件列表失败: ${result.error}`);
        }
    } catch (error) {
        term.writeln(`获取远程文件列表失败: ${error}`);
    }
}

function displayFiles(files, elementId, currentPath) {
    const fileList = document.getElementById(elementId);
    fileList.innerHTML = '';

    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        const iconClass = file.type === 'd' ? 'fa-folder' : 'fa-file';
        const iconColor = file.type === 'd' ? '#f1c40f' : '#3498db'; // 文件夹黄色，文件蓝色
        item.innerHTML = `<span><i class="fas ${iconClass}" style="color: ${iconColor};"></i> ${file.name}</span>`;
        item.addEventListener('click', () => handleFileClick(file, elementId));
        item.addEventListener('dblclick', () => handleFileDblClick(file, elementId));
        item.addEventListener('contextmenu', (e) => handleContextMenu(e, file, elementId));

        // 添加拖拽事件
        item.draggable = true;
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', file.name);
        });

        fileList.appendChild(item);
    });
}

function handleFileClick(file, sourceId) {
    // 单击选中文件，可以在这里添加选中效果
    // 例如：高亮显示选中的文件
    const fileItems = document.querySelectorAll(`#${sourceId} .file-item`);
    fileItems.forEach(item => item.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
}

async function handleFileDblClick(file, sourceId) {
    if (file.type === 'd') {
        // 如果是文件夹，进入该文件夹
        const newPath = `${sourceId === 'local-files' ? localCurrentPath : remoteCurrentPath}/${file.name}`.replace(/\/+/g, '/');
        if (sourceId === 'local-files') {
            localCurrentPath = newPath;
            await loadLocalFiles(newPath);
        } else {
            remoteCurrentPath = newPath;
            await loadRemoteFiles(newPath);
        }
    } else {
        // 如果是文件，执行上传或下载操作
        if (sourceId === 'local-files') {
            await uploadFile(file);
        } else {
            await downloadFile(file);
        }
    }
}

async function uploadFile(file, useSudo = false, draggedFile = null) {
    try {
        const sourcePath = draggedFile ? draggedFile.path : `${localCurrentPath}/${file.name}`;
        const result = await window.sftp.put(sourcePath, `${remoteCurrentPath}/${file.name}`, useSudo);
        if (result.success) {
            term.writeln(`上传成功: ${file.name}`);
            loadRemoteFiles(remoteCurrentPath);
        } else {
            if (result.error.includes('Permission denied') && !useSudo) {
                const useRoot = await showConfirmDialog('权限不足', '是否使用 sudo 权限上传？');
                if (useRoot) {
                    await uploadFile(file, true, draggedFile);
                } else {
                    term.writeln(`上传失败: ${file.name} - 权限不足`);
                }
            } else {
                term.writeln(`上传失败: ${file.name} - ${result.error}`);
            }
        }
    } catch (error) {
        term.writeln(`上传失败: ${file.name} - ${error}`);
    }
}

async function downloadFile(file, useSudo = false) {
    try {
        const result = await window.sftp.get(`${remoteCurrentPath}/${file.name}`, useSudo);
        if (result.success) {
            const savePath = await window.sftp.saveFile(result.data, file.name);
            if (savePath) {
                term.writeln(`文件 ${file.name} 下载成功，保存至 ${savePath}`);
                loadLocalFiles(localCurrentPath);
            } else {
                term.writeln(`文件 ${file.name} 下载成功，但用户取消了保存操作`);
            }
        } else {
            if (result.error.includes('Permission denied') && !useSudo) {
                const useRoot = await showConfirmDialog('权限不足', '是否使用 sudo 权限下载？');
                if (useRoot) {
                    await downloadFile(file, true);
                } else {
                    term.writeln(`下载失败: ${file.name} - 权限不足`);
                }
            } else {
                term.writeln(`下载失败: ${result.error}`);
            }
        }
    } catch (error) {
        term.writeln(`下载失败: ${error}`);
    }
}

function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        const existingDialog = document.querySelector('.confirm-dialog');
        if (existingDialog) {
            document.body.removeChild(existingDialog);
        }

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
                <div style="background: #1a1a1a; color: #fff; padding: 20px; border-radius: 5px; text-align: center;">
                    <h3>${title}</h3>
                    <p>${message}</p>
                    <button id="confirm-yes" style="background: #333; color: #fff; border: none; padding: 5px 10px; margin-right: 10px; cursor: pointer;">确认</button>
                    <button id="confirm-no" style="background: #333; color: #fff; border: none; padding: 5px 10px; cursor: pointer;">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        document.getElementById('confirm-yes').addEventListener('click', () => {
            if (document.body.contains(dialog)) {
                document.body.removeChild(dialog);
            }
            resolve(true);
        });

        document.getElementById('confirm-no').addEventListener('click', () => {
            if (document.body.contains(dialog)) {
                document.body.removeChild(dialog);
            }
            resolve(false);
        });
    });
}

function showPromptDialog(title, message) {
    return new Promise((resolve) => {
        const existingDialog = document.querySelector('.prompt-dialog');
        if (existingDialog) {
            document.body.removeChild(existingDialog);
        }

        const dialog = document.createElement('div');
        dialog.className = 'prompt-dialog';
        dialog.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
                <div style="background: #1a1a1a; color: #fff; padding: 20px; border-radius: 5px; text-align: center;">
                    <h3>${title}</h3>
                    <p>${message}</p>
                    <input type="text" id="prompt-input" style="width: 100%; margin-bottom: 10px; background: #333; color: #fff; border: 1px solid #555; padding: 5px;">
                    <button id="prompt-ok" style="background: #333; color: #fff; border: none; padding: 5px 10px; margin-right: 10px; cursor: pointer;">确定</button>
                    <button id="prompt-cancel" style="background: #333; color: #fff; border: none; padding: 5px 10px; cursor: pointer;">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        const input = document.getElementById('prompt-input');
        const okButton = document.getElementById('prompt-ok');
        const cancelButton = document.getElementById('prompt-cancel');

        function handleOk() {
            const inputValue = input.value;
            if (document.body.contains(dialog)) {
                document.body.removeChild(dialog);
            }
            resolve(inputValue);
        }

        okButton.addEventListener('click', handleOk);
        cancelButton.addEventListener('click', () => {
            if (document.body.contains(dialog)) {
                document.body.removeChild(dialog);
            }
            resolve(null);
        });

        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleOk();
            }
        });

        input.focus();
    });
}

function setupDesktopButton() {
    document.getElementById('local-desktop').addEventListener('click', async () => {
        const desktopPath = await window.sftp.getDesktopPath();
        localCurrentPath = desktopPath;
        loadLocalFiles(desktopPath);
    });
}

function setupContextMenu() {
    document.getElementById('local-files').addEventListener('contextmenu', (e) => {
        if (e.target === e.currentTarget) {
            handleContextMenu(e, null, 'local-files');
        }
    });
    document.getElementById('remote-files').addEventListener('contextmenu', (e) => {
        if (e.target === e.currentTarget) {
            handleContextMenu(e, null, 'remote-files');
        }
    });
}

function handleContextMenu(e, file, sourceId) {
    e.preventDefault();
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    let menuItems = '';
    if (file) {
        menuItems += `<div class="context-menu-item" data-action="delete">删除</div>`;
    }
    menuItems += `
        <div class="context-menu-item" data-action="new-file">新建文件</div>
        <div class="context-menu-item" data-action="new-folder">新建文件夹</div>
    `;
    contextMenu.innerHTML = menuItems;
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.top = `${e.pageY}px`;
    document.body.appendChild(contextMenu);

    contextMenu.addEventListener('click', async (event) => {
        const action = event.target.getAttribute('data-action');
        switch (action) {
            case 'delete':
                if (file) await handleDeleteFile(file, sourceId);
                break;
            case 'new-file':
                await handleNewFile(sourceId);
                break;
            case 'new-folder':
                await handleNewFolder(sourceId);
                break;
        }
        if (document.body.contains(contextMenu)) {
            document.body.removeChild(contextMenu);
        }
    });

    document.addEventListener('click', () => {
        if (document.body.contains(contextMenu)) {
            document.body.removeChild(contextMenu);
        }
    }, {once: true});
}

async function handleNewFile(sourceId) {
    const fileName = await showPromptDialog('新建文件', '请输入文件名：');
    if (fileName) {
        const path = sourceId === 'local-files' ? localCurrentPath : remoteCurrentPath;
        const fullPath = `${path}/${fileName}`.replace(/\/+/g, '/');
        try {
            if (sourceId === 'local-files') {
                await window.sftp.createLocalFile(fullPath);
                loadLocalFiles(localCurrentPath);
            } else {
                await window.sftp.createRemoteFile(fullPath);
                loadRemoteFiles(remoteCurrentPath);
            }
            term.writeln(`文件创建成功: ${fileName}`);
        } catch (error) {
            term.writeln(`文件创建失败: ${error}`);
        }
    }
}

async function handleNewFolder(sourceId) {
    const folderName = await showPromptDialog('新建文件夹', '请输入文件夹名：');
    if (folderName) {
        const path = sourceId === 'local-files' ? localCurrentPath : remoteCurrentPath;
        const fullPath = `${path}/${folderName}`.replace(/\/+/g, '/');
        try {
            if (sourceId === 'local-files') {
                await window.sftp.createLocalFolder(fullPath);
                loadLocalFiles(localCurrentPath);
            } else {
                await window.sftp.createRemoteFolder(fullPath);
                loadRemoteFiles(remoteCurrentPath);
            }
            term.writeln(`文件夹创建成功: ${folderName}`);
        } catch (error) {
            term.writeln(`文件夹创建失败: ${error}`);
        }
    }
}

async function handleDeleteFile(file, sourceId) {
    const isLocal = sourceId === 'local-files';
    const isDirectory = file.type === 'd';
    const confirmMessage = `确定要删除${isLocal ? '本地' : '远程'}${isDirectory ? '文件夹' : '文件'} "${file.name}" 吗？`;
    const confirmed = await showConfirmDialog('确认删除', confirmMessage);

    if (confirmed) {
        try {
            const path = `${isLocal ? localCurrentPath : remoteCurrentPath}/${file.name}`;
            const result = isLocal
                ? await window.sftp.deleteLocal(path, isDirectory)
                : await window.sftp.deleteRemote(path, isDirectory);

            if (result.success) {
                term.writeln(`删除成功: ${file.name}`);
                if (isLocal) {
                    loadLocalFiles(localCurrentPath);
                } else {
                    loadRemoteFiles(remoteCurrentPath);
                }
            } else {
                term.writeln(`删除失败: ${file.name} - ${result.error}`);
            }
        } catch (error) {
            term.writeln(`删除失败: ${file.name} - ${error}`);
        }
    }
}

async function loadSavedConnections() {
    const connections = await window.sftp.getSavedConnections();
    const select = document.getElementById('saved-connections');
    select.innerHTML = '<option value="">选择保存的连接</option>';
    connections.forEach(conn => {
        const option = document.createElement('option');
        option.value = conn.id;
        option.textContent = conn.name;
        select.appendChild(option);
    });
    if (connections.length > 0) {
        select.value = connections[0].id;
        await loadConnectionDetails(connections[0].id);
    }

    // 为删除按钮添加事件监听器
    const deleteButton = document.getElementById('delete-connection');
    if (deleteButton) {
        deleteButton.addEventListener('click', deleteSelectedConnection);
    }
}

async function deleteSelectedConnection() {
    const select = document.getElementById('saved-connections');
    const selectedId = select.value;

    if (!selectedId) {
        term.writeln('请先选择一个连接');
        return;
    }

    try {
        await window.sftp.deleteConnection(selectedId);
        term.writeln('连接已删除');
        await loadSavedConnections();
    } catch (error) {
        term.writeln(`删除连接失败: ${error}`);
    }
}

async function loadConnectionDetails(id) {
    const conn = await window.sftp.getSavedConnection(id);
    document.getElementById('connection-name').value = conn.name;
    document.getElementById('host').value = conn.host;
    document.getElementById('port').value = conn.port;
    document.getElementById('username').value = conn.username;
    document.getElementById('password').value = conn.password; // 加载保存的密码
}

document.getElementById('saved-connections').addEventListener('change', async (e) => {
    const connId = e.target.value;
    if (connId) {
        await loadConnectionDetails(connId);
    }
});

function setupDragAndDrop() {
    const localFiles = document.getElementById('local-files');
    const remoteFiles = document.getElementById('remote-files');

    // 为整个窗口添加拖拽事件监听
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer.files;
        for (const file of files) {
            await uploadFile({name: file.name, path: file.path}, false, file);
        }
    });

    // 为本地文件列表添加拖拽事件
    localFiles.addEventListener('dragstart', (e) => {
        const fileName = e.target.textContent.trim();
        e.dataTransfer.setData('text/plain', fileName);
    });

    // 为远程文件列表添加拖拽事件
    remoteFiles.addEventListener('dragstart', (e) => {
        const fileName = e.target.textContent.trim();
        e.dataTransfer.setData('text/plain', fileName);
    });
}

function setupSearch() {
    const localSearchInput = document.getElementById('local-search');
    const remoteSearchInput = document.getElementById('remote-search');

    localSearchInput.addEventListener('input', () => {
        const searchTerm = localSearchInput.value.toLowerCase();
        filterFiles('local-files', searchTerm);
    });

    remoteSearchInput.addEventListener('input', () => {
        const searchTerm = remoteSearchInput.value.toLowerCase();
        filterFiles('remote-files', searchTerm);
    });
}

function filterFiles(elementId, searchTerm) {
    const fileList = document.getElementById(elementId);
    const fileItems = fileList.getElementsByClassName('file-item');

    for (const item of fileItems) {
        const fileName = item.textContent.toLowerCase();
        if (fileName.includes(searchTerm)) {
            item.style.display = 'block';
        } else {
            item.style.display = 'none';
        }
    }
}
