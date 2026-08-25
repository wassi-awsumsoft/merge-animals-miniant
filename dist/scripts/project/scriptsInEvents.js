
function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
} 



const scriptsInEvents = {

	async Utilsevent_Event2_Act1(runtime, localVars)
	{
		localVars.res = numberWithCommas(localVars.x)
	},

	async Utilsevent_Event4_Act1(runtime, localVars)
	{
		localVars.res = MD5(localVars.x)
	}

};

self.C3.ScriptsInEvents = scriptsInEvents;

