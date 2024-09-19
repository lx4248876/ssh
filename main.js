process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const {app, BrowserWindow, ipcMain, dialog} = require('electron');
const path = require('path');
const Client = require('ssh2-sftp-client');
const fs = require('fs').promises;
const Store = require('electron-store');
const SSH2 = require('ssh2');
const os = require('os');

let sftpClient = new Client();
const store = new Store();
let sshConnection = null;

function createWindow() {
    const windowState = store.get('windowState', {
        width: 1000,
        height: 600
    });

    const win = new BrowserWindow({
        ...windowState,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile('index.html');

    win.on('close', () => {
        store.set('windowState', win.getBounds());
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.handle('sftp:connect', async (event, config) => {
    try {
        await sftpClient.connect(config);
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:list', async (event, path) => {
    try {
        const files = await sftpClient.list(path);
        return {
            success: true,
            files: files.map(file => ({
                ...file,
                time: new Date(file.modifyTime).toISOString()
            }))
        };
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:get', async (event, path, useSudo) => {
    try {
        let data;
        if (useSudo) {
            // 使用 sudo 权限下载文件
            data = await sftpClient.get(path, null, {
                readFileOptions: {
                    encoding: null,
                    flag: 'r',
                    mode: 0o666
                }
            });
        } else {
            data = await sftpClient.get(path);
        }
        return {success: true, data};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:put', async (event, localPath, remotePath, useSudo) => {
    try {
        const data = await fs.readFile(localPath);
        if (useSudo) {
            // 使用 sudo 权限上传文件
            await sftpClient.put(data, remotePath, {
                mode: 0o777,
                beforeUpload: (sftp) => {
                    return sftp.chmod(remotePath, '0777');
                }
            });
        } else {
            await sftpClient.put(data, remotePath);
        }
        return {success: true};
    } catch (error) {
        console.error('SFTP put error:', error);
        return {
            success: false,
            error: error.message,
            details: error.code === 'EACCES' ? '权限被拒绝' : '未知错误'
        };
    }
});

ipcMain.handle('sftp:disconnect', async () => {
    if (sftpClient) {
        await sftpClient.end();
        sftpClient = null;
    }
    return {success: true};
});

ipcMain.handle('sftp:getSavedConnections', () => {
    return store.get('connections', []);
});

ipcMain.handle('sftp:getSavedConnection', (event, id) => {
    const connections = store.get('connections', []);
    return connections.find(conn => conn.id === id);
});

ipcMain.handle('sftp:saveConnection', (event, config) => {
    const connections = store.get('connections', []);
    const existingIndex = connections.findIndex(conn =>
        conn.host === config.host &&
        conn.port === config.port &&
        conn.username === config.username
    );

    if (existingIndex !== -1) {
        // 更新现有连接
        connections[existingIndex] = {...connections[existingIndex], ...config};
    } else {
        // 添加新连接
        config.id = Date.now().toString();
        connections.push(config);
    }

    store.set('connections', connections);
    return config;
});

ipcMain.handle('sftp:listLocal', async (event, path) => {
    try {
        const files = await fs.readdir(path, {withFileTypes: true});
        const fileInfos = await Promise.all(files.map(async (file) => {
            try {
                const fullPath = `${path}/${file.name}`;
                const stat = await fs.stat(fullPath);
                return {
                    name: file.name,
                    type: file.isDirectory() ? 'd' : '-',
                    time: stat.mtime.toISOString(),
                    size: stat.size
                };
            } catch (error) {
                // 如果无法获取文件信息，返回一个带有错误标记的对象
                return {
                    name: file.name,
                    type: 'error',
                    error: error.code
                };
            }
        }));
        // 过滤掉无法访问的文件
        return fileInfos.filter(file => file.type !== 'error');
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:saveFile', async (event, data, name) => {
    try {
        const {filePath} = await dialog.showSaveDialog({
            defaultPath: name
        });
        if (filePath) {
            await fs.writeFile(filePath, data);
            return filePath;
        }
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:getCurrentDirectory', () => {
    return process.cwd();
});

ipcMain.handle('sftp:executeSudoCommand', async (event, {host, port, username, password, command}) => {
    return new Promise((resolve, reject) => {
        const conn = new SSH2.Client();
        conn.on('ready', () => {
            conn.exec(`echo '${password}' | sudo -S ${command}`, (err, stream) => {
                if (err) {
                    conn.end();
                    reject(err);
                    return;
                }
                let output = '';
                stream.on('close', (code, signal) => {
                    conn.end();
                    resolve({success: code === 0, output});
                }).on('data', (data) => {
                    output += data;
                }).stderr.on('data', (data) => {
                    output += data;
                });
            });
        }).connect({host, port, username, password});
    });
});

ipcMain.handle('sftp:deleteLocal', async (event, path, isDirectory) => {
    try {
        if (isDirectory) {
            await fs.rmdir(path, {recursive: true});
        } else {
            await fs.unlink(path);
        }
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:deleteRemote', async (event, path, isDirectory) => {
    try {
        if (isDirectory) {
            await sftpClient.rmdir(path, true);
        } else {
            await sftpClient.delete(path);
        }
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:getDesktopPath', () => {
    return path.join(os.homedir(), 'Desktop');
});

ipcMain.handle('sftp:createLocalFile', async (event, path) => {
    try {
        await fs.writeFile(path, '');
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:createRemoteFile', async (event, path) => {
    try {
        await sftpClient.put(Buffer.from(''), path);
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:createLocalFolder', async (event, path) => {
    try {
        await fs.mkdir(path);
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:createRemoteFolder', async (event, path) => {
    try {
        await sftpClient.mkdir(path);
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('sftp:deleteConnection', async (event, id) => {
    try {
        const connections = store.get('connections', []);
        const updatedConnections = connections.filter(conn => conn.id !== id);
        store.set('connections', updatedConnections);
        return {success: true};
    } catch (error) {
        return {success: false, error: error.message};
    }
});

ipcMain.handle('ssh:connect', async (event, config) => {
    return new Promise((resolve, reject) => {
        sshConnection = new SSH2.Client();
        sshConnection.on('ready', () => {
            sshConnection.shell({term: 'xterm-color'}, (err, stream) => {
                if (err) {
                    reject({success: false, error: err.message});
                    return;
                }
                stream.on('close', () => {
                    sshConnection = null;
                }).on('data', (data) => {
                    event.sender.send('ssh:data', data.toString());
                });
                sshConnection.stream = stream;  // 保存 stream 引用
                resolve({success: true});
            });
        }).on('error', (err) => {
            reject({success: false, error: err.message});
        }).connect(config);
    });
});

ipcMain.handle('ssh:write', async (event, data) => {
    if (sshConnection && sshConnection.stream) {
        sshConnection.stream.write(data);
    }
});

ipcMain.handle('ssh:disconnect', async () => {
    if (sshConnection) {
        sshConnection.end();
        sshConnection = null;
    }
});

ipcMain.handle('ssh:execute', async (event, command) => {
    return new Promise((resolve, reject) => {
        if (!sshConnection || !sshConnection.stream) {
            reject({success: false, error: 'SSH未连接'});
            return;
        }
        let output = '';
        sshConnection.stream.write(command + '\n');
        sshConnection.stream.on('data', (data) => {
            output += data.toString();
        });
        sshConnection.stream.on('close', () => {
            resolve({success: true, output});
        });
    });
});

ipcMain.handle('ssh:resetClient', async () => {
    if (sshConnection) {
        sshConnection.end();
        sshConnection = null;
    }
    return {success: true};
});

ipcMain.handle('sftp:resetClient', async () => {
    if (sftpClient) {
        await sftpClient.end();
    }
    sftpClient = new Client();
    return {success: true};
});
