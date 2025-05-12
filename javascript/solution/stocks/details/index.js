const setFields = (stock) => {
    const elementTitle = document.getElementById("app-title");
    elementTitle.innerText = `Stock Details ${stock.RIC}`;

    const elementRIC = document.querySelectorAll("[data-ric]")[0];
    elementRIC.innerText = stock.RIC;

    const elementBPOD = document.querySelectorAll("[data-bpod]")[0];
    elementBPOD.innerText = stock.BPOD;

    const elementBloomberg = document.querySelectorAll("[data-bloomberg]")[0];
    elementBloomberg.innerText = stock.Bloomberg;

    const elementDescription = document.querySelectorAll("[data-description]")[0];
    elementDescription.innerText = stock.Description;

    const elementExchange = document.querySelectorAll("[data-exchange]")[0];
    elementExchange.innerText = stock.Exchange;

    const elementVenues = document.querySelectorAll("[data-venues]")[0];
    elementVenues.innerText = stock.Venues;

    updateStockPrices(stock.Bid, stock.Ask);
};

const updateStockPrices = (bid, ask) => {
    const elementBid = document.querySelectorAll("[data-bid]")[0];
    elementBid.innerText = bid;

    const elementAsk = document.querySelectorAll("[data-ask]")[0];
    elementAsk.innerText = ask;
};

// TODO: Chapter 3
const toggleIOAvailable = () => {
    const span = document.getElementById("ioConnectSpan");

    span.classList.remove("bg-danger");
    span.classList.add("bg-success");
    span.textContent = "io.Connect is available";
};

// TODO: Chapter 6.2
const updateClientStatus = (client, stock) => {
    const message = client.portfolio.includes(stock.RIC) ?
        `${stock.RIC} is in ${client.name}'s portfolio.` :
        `${stock.RIC} isn't in ${client.name}'s portfolio.`;
    const elementTitle = document.getElementById("clientStatus");

    elementTitle.innerText = message;
};

const start = async () => {
    // TODO: Chapter 3
    const config = {
        appManager: "full"
    };

    const io = await IODesktop(config);

    window.io = io;

    toggleIOAvailable();

    // TODO: Chapter 4.3
    // const myWindow = io.windows.my();
    // const stock = await myWindow.getContext();

    // TODO: Chapter 8.3
    // const stock = await io.appManager.myInstance.getContext();

    // setFields(stock);

    // TODO: Chapter 5.4
    // const subscription = await io.interop.subscribe("LivePrices");

    // const streamDataHandler = (streamData) => {
    //     const updatedStocks = streamData.data.stocks;
    //     const selectedStockPrice = updatedStocks.find(updatedStock => updatedStock.RIC === stock.RIC);

    //     updateStockPrices(selectedStockPrice.Bid, selectedStockPrice.Ask);
    // };

    // subscription.onData(streamDataHandler);

    // TODO: Chapter 6.2
    // const updateHandler = (client) => {
    //     updateClientStatus(client, stock);
    // };

    // io.contexts.subscribe("SelectedClient", updateHandler);

    // TODO: Chapter 9.5
    const myWindow = io.windows.my();
    const context = await myWindow.getContext();
    let selectedStock;

    if (context && context.stock) {
        selectedStock = context.stock;

        setFields(selectedStock);
    };

    const updateHandler = (context) => {
        if (context.stock) {
            selectedStock = context.stock;

            setFields(selectedStock);
        };
    };

    myWindow.onContextUpdated(updateHandler);

    const subscription = await io.interop.subscribe("LivePrices");

    const streamDataHandler = (streamData) => {
        if (!selectedStock) {
            return;
        };

        const updatedStocks = streamData.data.stocks;
        const selectedStockPrice = updatedStocks.find(updatedStock => updatedStock.RIC === selectedStock.RIC);

        updateStockPrices(selectedStockPrice.Bid, selectedStockPrice.Ask);
    };

    subscription.onData(streamDataHandler);
};

start().catch(console.error);