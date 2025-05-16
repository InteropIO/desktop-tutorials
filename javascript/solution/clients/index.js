const setupClients = (clients) => {
    const table = document.getElementById("clientsTable").getElementsByTagName("tbody")[0];

    const addRowCell = (row, cellData, cssClass) => {
        const cell = document.createElement("td");

        cell.innerText = cellData;

        if (cssClass) {
            cell.className = cssClass;
        };

        row.appendChild(cell);
    };

    const addRow = (table, client) => {
        const row = document.createElement("tr");

        addRowCell(row, client.name || "");
        addRowCell(row, client.pId || "");
        addRowCell(row, client.gId || "");
        addRowCell(row, client.accountManager || "");

        row.onclick = () => {
            clientClickedHandler(client);
        };

        table.appendChild(row);
    };

    clients.forEach((client) => {
        addRow(table, client);
    });
};

// TODO: Chapter 3
const toggleIOAvailable = () => {
    const span = document.getElementById("ioConnectSpan");

    span.classList.remove("bg-danger");
    span.classList.add("bg-success");
    span.textContent = "io.Connect is available";
};

const clientClickedHandler = async (client) => {
    // TODO: Chapter 5.2
    // const selectClientStocks = io.interop.methods().find(method => method.name === "SelectClient");

    // TODO: Chapter 5.3
    // if (selectClientStocks) {
    //     io.interop.invoke(selectClientStocks, { client });
    // };

    // TODO: Chapter 6.1
    // io.contexts.update("SelectedClient", client).catch(console.error);

    // TODO: Chapter 7.2
    // const currentChannel = io.channels.my();

    // if (currentChannel) {
    //     io.channels.publish(client).catch(console.error);
    // };

    // TODO: Chapter 9.3
    const restoreConfig = {
        context: { client }
    };

    try {
        const workspace = await io.workspaces.restoreWorkspace("Client Space", restoreConfig);

        await raiseNotificationOnWorkspaceOpen(client.name, workspace);
    } catch (error) {
        console.error(error.message);
    };

};

// let counter = 1;

// const stocksButtonHandler = () => {
//     // const instanceID = sessionStorage.getItem("counter");

//     // TODO: Chapter 4.1
//     // const name = `Stocks-${instanceID || counter}`;
//     // const URL = "http://localhost:9100/";
//     // const config = {
//     //     width: 500,
//     //     height: 450,
//     //     minWidth: 450,
//     //     minHeight: 400,
//     //     channelSelector: {
//     //         enabled: true
//     //     }
//     // };

//     // io.windows.open(name, URL, config).catch(console.error);

//     // counter++;
//     // sessionStorage.setItem("counter", counter);

//     // TODO: Chapter 8.1
//     const stocksApp = io.appManager.application("stocks");
//     const currentChannel = io.channels.my();
//     const context = { channel: currentChannel };

//     stocksApp.start(context).catch(console.error);
// };

const raiseNotificationOnWorkspaceOpen = async (clientName, workspace) => {
    // TODO: Chapter 11.1
    const options = {
        title: "New Workspace",
        body: `A new Workspace for ${clientName} was opened!`,
    };

    const notification = await io.notifications.raise(options);

    notification.onclick = () => {
        workspace.frame.focus().catch(console.error);
        workspace.focus().catch(console.error);
    };
};

const start = async () => {
    const html = document.documentElement;
    const initialTheme = iodesktop.theme;

    html.className = initialTheme;

    const clientsResponse = await fetch("http://localhost:8080/api/clients");
    const clients = await clientsResponse.json();

    setupClients(clients);

    // const stocksButton = document.getElementById("stocks-btn");

    // stocksButton.onclick = stocksButtonHandler;

    // TODO: Chapter 3
    const config = {
        // channels: true,
        libraries: [IOWorkspaces]
    };

    const io = await IODesktop(config);

    window.io = io;

    toggleIOAvailable();

    // TODO: Chapter 12.1
    const themeHandler = (newTheme) => {
        html.className = newTheme.name;
    };

    io.themes.onChanged(themeHandler);

    // TODO: Chapter 13
    const stocksAppHotkey = {
        hotkey: "alt+shift+s",
        description: "Starts the Stocks app."
    };

    const stocksAppHotkeyHandler = () => io.appManager.application("stocks").start();

    const themeHotkey = {
        hotkey: "alt+shift+t",
        description: "Toggles the platform theme."
    };

    const themeHotkeyHandler = async () => {
        const currentTheme = await io.themes.getCurrent();
        const themeToSelect = currentTheme.name === "dark" ? "light" : "dark";

        io.themes.select(themeToSelect);
    };

    io.hotkeys.register(stocksAppHotkey, stocksAppHotkeyHandler);
    io.hotkeys.register(themeHotkey, themeHotkeyHandler);
};

start().catch(console.error);