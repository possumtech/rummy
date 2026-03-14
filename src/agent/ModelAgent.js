export default class ModelAgent {
	#db;

	constructor(db) {
		this.#db = db;
	}

	async getModels() {
		return await this.#db.get_models.all();
	}
}
