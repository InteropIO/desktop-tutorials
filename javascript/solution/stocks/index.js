let clientPortfolioStocks;
let clientName;

const generateStockPrices = (handleNewPrices) => {
    setInterval(() => {
        const priceUpdate = {
            stocks: [
                {
                    RIC: "VOD.L",
                    Bid: Number(70 - Math.random() * 10).toFixed(2),
                    Ask: Number(70 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "TSCO.L",
                    Bid: Number(90 - Math.random() * 10).toFixed(2),
                    Ask: Number(90 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "BARC.L",
                    Bid: Number(105 - Math.random() * 10).toFixed(2),
                    Ask: Number(105 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "BMWG.DE",
                    Bid: Number(29 - Math.random() * 10).toFixed(2),
                    Ask: Number(29 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "AAL.L",
                    Bid: Number(46 - Math.random() * 10).toFixed(2),
                    Ask: Number(46 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "IBM.N",
                    Bid: Number(70 - Math.random() * 10).toFixed(2),
                    Ask: Number(70 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "AAPL.OQ",
                    Bid: Number(90 - Math.random() * 10).toFixed(2),
                    Ask: Number(90 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "BA.N",
                    Bid: Number(105 - Math.random() * 10).toFixed(2),
                    Ask: Number(105 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "TSLA:OQ",
                    Bid: Number(29 - Math.random() * 10).toFixed(2),
                    Ask: Number(29 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "ENBD.DU",
                    Bid: Number(46 - Math.random() * 10).toFixed(2),
                    Ask: Number(46 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "AMZN.OQ",
                    Bid: Number(29 - Math.random() * 10).toFixed(2),
                    Ask: Number(29 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "MSFT:OQ",
                    Bid: Number(46 - Math.random() * 10).toFixed(2),
                    Ask: Number(46 + Math.random() * 10).toFixed(2)
                }
            ]
        };

        handleNewPrices(priceUpdate);
    }, 1500);
};

const setupStocks = (stocks) => {
    const table = document.getElementById("stocksTable").getElementsByTagName("tbody")[0];

    table.innerHTML = "";

    const addRowCell = (row, cellData, cssClass) => {
        const cell = document.createElement("td");

        cell.innerText = cellData;

        if (cssClass) {
            cell.className = cssClass;
        };
        row.appendChild(cell);
    };

    const addRow = (table, stock) => {
        const row = document.createElement("tr");

        addRowCell(row, stock.RIC || "");
        addRowCell(row, stock.Description || "");
        addRowCell(row, stock.Bid || "");
        addRowCell(row, stock.Ask || "");

        row.setAttribute("data-ric", stock.RIC);

        row.onclick = () => {
            stockClickedHandler(stock);
        };

        table.appendChild(row);
    };

    stocks.forEach((stock) => {
        addRow(table, stock);
    });
};

// TODO: Chapter 3
const toggleIOAvailable = () => {
    const span = document.getElementById("ioConnectSpan");

    span.classList.remove("bg-danger");
    span.classList.add("bg-success");
    span.textContent = "io.Connect is available";
};

const newPricesHandler = (priceUpdate) => {
    priceUpdate.stocks.forEach((stock) => {
        const row = document.querySelectorAll(`[data-ric="${stock.RIC}"]`)[0];

        if (!row) {
            return;
        };

        const bidElement = row.children[2];
        bidElement.innerText = stock.Bid;

        const askElement = row.children[3];
        askElement.innerText = stock.Ask;
    });

    // TODO: Chapter 5.1
    if (priceStream) {
        priceStream.push(priceUpdate);
    };
};

const stockClickedHandler = async (stock) => {
    // TODO: Chapter 4.1
    // window.location.href = `http://${window.location.host}/details/index.html`;
    // const name = `${stock.BPOD} Details`;
    // const URL = "http://localhost:9101/details/";
    // const config = {
    //     left: 100,
    //     top: 100,
    //     width: 550,
    //     height: 350,
    //     context: stock
    // };

    // const stockWindowExists = io.windows.list().find(w => w.name === name);

    // if (!stockWindowExists) {
    //     io.windows.open(name, URL, config).catch(console.error);
    // };

    // TODO: Chapter 8.3
    // const detailsApp = io.appManager.application("stock-details-solution");

    // const contexts = await Promise.all(
    //     detailsApp.instances.map(instance => instance.getContext())
    // );
    // const isRunning = contexts.find(context => context.RIC === stock.RIC);

    // if (!isRunning) {
    //     const options = {
    //         ignoreSavedLayout: true,
    //         left: 100,
    //         top: 100,
    //         width: 550,
    //         height: 350
    //     };

    //     detailsApp.start(stock, options).catch(console.error);
    // };

    // TODO: Chapter 9.5
    let detailsWindow;

    const myWorkspace = await io.workspaces.getMyWorkspace();

    let detailsWorkspaceWindow = myWorkspace.getWindow(window => window.appName === "stock-details-solution");

    if (detailsWorkspaceWindow) {
        detailsWindow = detailsWorkspaceWindow.getGdWindow();
    } else {
        const myId = io.windows.my().id;
        const myImmediateParent = myWorkspace.getWindow(window => window.id === myId).parent;
        const group = await myImmediateParent.parent.addGroup();

        detailsWorkspaceWindow = await group.addWindow({ appName: "stock-details-solution" });

        await detailsWorkspaceWindow.forceLoad();

        detailsWindow = detailsWorkspaceWindow.getGdWindow();
    };

    detailsWindow.updateContext({ stock });
};

const exportPortfolioButtonHandler = async (portfolio) => {
    // TODO: Chapter 10.2
    try {
        const intents = await io.intents.find("ExportPortfolio (solution)");

        if (!intents) {
            return;
        };

        const intentRequest = {
            intent: "ExportPortfolio (solution)",
            context: {
                type: "ClientPortfolio",
                data: { portfolio, clientName }
            }
        };

        await io.intents.raise(intentRequest);

    } catch (error) {
        console.error(error.message);
    };
};


const start = async () => {
    const html = document.documentElement;
    const initialTheme = iodesktop.theme;

    html.className = initialTheme;

    const stocksResponse = await fetch("http://localhost:8080/api/portfolio");
    const stocks = await stocksResponse.json();

    setupStocks(stocks);
    generateStockPrices(newPricesHandler);

    // TODO: Chapter 3
    const config = {
        // channels: true,
        // appManager: "full",
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

    // TODO: Chapter 5.1
    // const methodName = "SelectClient";
    // const methodHandler = (args) => {
    //     const clientPortfolio = args.client.portfolio;
    //     const stockToShow = stocks.filter(stock => clientPortfolio.includes(stock.RIC));

    //     setupStocks(stockToShow);
    // };

    // io.interop.register(methodName, methodHandler);

    window.priceStream = await io.interop.createStream("LivePrices");

    // TODO: Chapter 6.2
    // const updateHandler = (client) => {
    //     const clientPortfolio = client.portfolio;
    //     const stockToShow = stocks.filter(stock => clientPortfolio.includes(stock.RIC));

    //     setupStocks(stockToShow);
    // };

    // io.contexts.subscribe("SelectedClient", updateHandler);

    // TODO: Chapter 8.2
    // const appContext = await io.appManager.myInstance.getContext();
    // const channelToJoin = appContext.channel;

    // if (channelToJoin) {
    //     await io.channels.join(channelToJoin);
    // };

    // TODO: Chapter 7.2
    // const updateHandler = (client) => {
    //     if (client.portfolio) {
    //         const clientPortfolio = client.portfolio;
    //         const stockToShow = stocks.filter(stock => clientPortfolio.includes(stock.RIC));

    //         setupStocks(stockToShow);
    //     };
    // };

    // io.channels.subscribe(updateHandler);

    // TODO: Chapter 9.4
    const myWorkspace = await io.workspaces.getMyWorkspace();

    if (myWorkspace) {
        const updateHandler = (context) => {
            if (context.client) {
                const clientPortfolio = context.client.portfolio;
                clientPortfolioStocks = stocks.filter((stock) => clientPortfolio.includes(stock.RIC));
                clientName = context.client.name;

                setupStocks(clientPortfolioStocks);
            };
        };

        myWorkspace.onContextUpdated(updateHandler);
    };

    // TODO: Chapter 10.2
    const exportPortfolioButton = document.getElementById("exportPortfolio");

    exportPortfolioButton.onclick = () => {
        if (!clientPortfolioStocks) {
            return;
        };

        exportPortfolioButtonHandler(clientPortfolioStocks).catch(console.error);
    };
};

start().catch(console.error);