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
// const toggleIOAvailable = () => {
//     const span = document.getElementById("ioConnectSpan");

//     span.classList.remove("bg-danger");
//     span.classList.add("bg-success");
//     span.textContent = "io.Connect is available";
// };

const clientClickedHandler = async (client) => {
    // TODO: Chapter 5.2

    // TODO: Chapter 5.3

    // TODO: Chapter 6.1

    // TODO: Chapter 7.2

    // TODO: Chapter 9.3
};

let counter = 1;

const stocksButtonHandler = () => {
    const instanceID = sessionStorage.getItem("counter");

    // TODO: Chapter 4.1

    counter++;
    sessionStorage.setItem("counter", counter);

    // TODO: Chapter 8.1
};

const raiseNotificationOnWorkspaceOpen = async (clientName, workspace) => {
    // TODO: Chapter 11.1
};

const start = async () => {
    const clientsResponse = await fetch("http://localhost:8080/api/clients");
    const clients = await clientsResponse.json();

    setupClients(clients);

    const stocksButton = document.getElementById("stocks-btn");

    stocksButton.onclick = stocksButtonHandler;

    // TODO: Chapter 3

    // TODO: Chapter 12.1
};

start().catch(console.error);