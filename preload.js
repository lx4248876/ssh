const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('sftp', {
    connect: (config) => ipcRenderer.invoke('sftp:connect', config),
    list: (path) => ipcRenderer.invoke('sftp:list', path),
    get: (path, useSudo) => ipcRenderer.invoke('sftp:get', path, useSudo),
    put: (localPath, remotePath, useSudo) => ipcRenderer.invoke('sftp:put', localPath, remotePath, useSudo),
    disconnect: () => ipcRenderer.invoke('sftp:disconnect'),
    resetClient: () => ipcRenderer.invoke('sftp:resetClient'),
    getSavedConnections: () => ipcRenderer.invoke('sftp:getSavedConnections'),
    getSavedConnection: (id) => ipcRenderer.invoke('sftp:getSavedConnection', id),
    saveConnection: (config) => ipcRenderer.invoke('sftp:saveConnection', config),
    listLocal: (path) => ipcRenderer.invoke('sftp:listLocal', path),
    saveFile: (data, name) => ipcRenderer.invoke('sftp:saveFile', data, name),
    getCurrentDirectory: () => ipcRenderer.invoke('sftp:getCurrentDirectory'),
    executeSudoCommand: (config) => ipcRenderer.invoke('sftp:executeSudoCommand', config),
    deleteLocal: (path, isDirectory) => ipcRenderer.invoke('sftp:deleteLocal', path, isDirectory),
    deleteRemote: (path, isDirectory) => ipcRenderer.invoke('sftp:deleteRemote', path, isDirectory),
    createLocalFile: (path) => ipcRenderer.invoke('sftp:createLocalFile', path),
    createRemoteFile: (path) => ipcRenderer.invoke('sftp:createRemoteFile', path),
    createLocalFolder: (path) => ipcRenderer.invoke('sftp:createLocalFolder', path),
    createRemoteFolder: (path) => ipcRenderer.invoke('sftp:createRemoteFolder', path),
    getDesktopPath: () => ipcRenderer.invoke('sftp:getDesktopPath'),
    deleteConnection: (id) => ipcRenderer.invoke('sftp:deleteConnection', id),
    onTransferProgress: (callback) => ipcRenderer.on('sftp:transferProgress', (event, data) => callback(data)),
    removeTransferProgressListener: () => ipcRenderer.removeAllListeners('sftp:transferProgress'),
});

contextBridge.exposeInMainWorld('ssh', {
    connect: (config) => ipcRenderer.invoke('ssh:connect', config),
    disconnect: () => ipcRenderer.invoke('ssh:disconnect'),
    resetClient: () => ipcRenderer.invoke('ssh:resetClient'),
    write: (data) => ipcRenderer.invoke('ssh:write', data),
    onData: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('ssh:data', listener);
        return listener;  // 返回监听器，以便之后可以移除
    },
    removeDataListener: (listener) => {
        ipcRenderer.removeListener('ssh:data', listener);
    },
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('ssh:data');
    },
});
