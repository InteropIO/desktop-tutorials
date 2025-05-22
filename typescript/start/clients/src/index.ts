const setupClients = (clients: Client[]): void => {
    const table = document.getElementById("clientsTable")?.getElementsByTagName("tbody")[0];
    if (!table) return;

    const addRowCell = (row: HTMLTableRowElement, cellData: string, cssClass?: string): void => {
        const cell = document.createElement("td");

        cell.innerText = cellData;

        if (cssClass) {
            cell.className = cssClass;
        }

        row.appendChild(cell);
    };

    const addRow = (table: HTMLTableSectionElement, client: Client): void => {
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
// const toggleIOAvailable = (): void => {
//     const span = document.getElementById("ioConnectSpan");
//     if (!span) return;

//     span.classList.remove("bg-danger");
//     span.classList.add("bg-success");
//     span.textContent = "io.Connect is available";
// };

const clientClickedHandler = async (client: Client): Promise<void> => {
    // TODO: Chapter 5.2

    // TODO: Chapter 5.3

    // TODO: Chapter 6.1

    // TODO: Chapter 7.2

    // TODO: Chapter 9.3
};

let counter = 1;

const stocksButtonHandler = (): void => {
    const instanceID = sessionStorage.getItem("counter");

    // TODO: Chapter 4.1

    counter++;
    sessionStorage.setItem("counter", counter.toString());

    // TODO: Chapter 8.1
};

const raiseNotificationOnWorkspaceOpen = async (clientName: string, workspace: Workspace): Promise<void> => {
    // TODO: Chapter 11.1
};

const start = async (): Promise<void> => {
    const clientsResponse = await fetch("http://localhost:8080/api/clients");
    const clients = await clientsResponse.json() as Client[];

    setupClients(clients);

    const stocksButton = document.getElementById("stocks-btn");
    if (stocksButton) {
        stocksButton.onclick = stocksButtonHandler;
    }

    // TODO: Chapter 3

    // TODO: Chapter 12.1

    // TODO: Chapter 13
};

// Add io property to window object when needed
declare global {
    interface Window {
        io?: IODesktopAPI;
    }
}

start().catch(console.error);