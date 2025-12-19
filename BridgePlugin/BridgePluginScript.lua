-- ========================================


-- ROBLOX STUDIO MCP BRIDGE PLUGIN v2.0


-- ========================================


-- Purpose: Lua Code Executor (NO HTTP!)


-- Architecture: Premium Plugin sends code via shared storage


-- License: Free (Open Source)


-- ========================================


local RunService = game:GetService("RunService")


print("\n" .. string.rep("=", 60))


print("?? ROBLOX STUDIO MCP BRIDGE PLUGIN v2.0")


print(string.rep("=", 60))


print("Architecture: Code Executor Only")


print("HTTP: None (Premium Plugin handles it)")


print(string.rep("=", 60) .. "\n")


-- Check Premium Plugin Connection


print("?? Pruefe Premium Plugin Verbindung...")


local premiumPlugin = shared.RobloxStudioMCP_Premium


if premiumPlugin then


	if premiumPlugin.Version then


		print("   Version: " .. premiumPlugin.Version)


	end


	if premiumPlugin.GenerateLua then


		print("   ? GenerateLua() Funktion verfuegbar")


	else


		print("   ? GenerateLua() Funktion FEHLT!")


	end


	if premiumPlugin.Tools then


		local toolCount = 0


		for _ in pairs(premiumPlugin.Tools) do


			toolCount = toolCount + 1


		end


		print("   ?? Verfuegbare Tools: " .. toolCount)


	end


	print("   ?? Bridge <-> Premium Kommunikation bereit!")


else


	print("? Premium Plugin NICHT gefunden!")


	print("??  Bitte installiere das Premium Plugin:")


	print("   1. Kaufe im Roblox Store (500-1000 Robux)")


	print("   2. Installiere das Plugin in Roblox Studio")


	print("   3. Starte Roblox Studio neu")


	print("   ?? Link: https://www.roblox.com/... (TODO)")


end


print(string.rep("=", 60) .. "\n")


-- Status


local lastExecutedId = nil


-- Execute Lua code and capture output


local function executeCode(luaCode)

	local output = {}

	local oldPrint = print

	-- Check for empty/invalid code first

	if not luaCode or luaCode == "" or #luaCode == 0 then

		return false, "[ERROR] Leerer oder ung�ltiger Lua-Code erhalten - Parameter-Validierung erforderlich"

	end

	-- Override print to capture output

	print = function(...)

		local args = {...}

		local line = ""

		for i, v in ipairs(args) do

			if i > 1 then line = line .. "\t" end

			line = line .. tostring(v)

		end

		table.insert(output, line)

		oldPrint(...)  -- Also print to console

	end

	-- Execute code

	local success, result = pcall(function()

		local func, loadErr = loadstring(luaCode)

		if not func then

			-- Provide detailed error information for debugging

			local errorMsg = "[ERROR] Lua Load Error: " .. tostring(loadErr)

			print = oldPrint

			print(errorMsg)

			return false, errorMsg

		end

		func()

	end)

	-- Restore print

	print = oldPrint

	if success then

		local outputStr = table.concat(output, "\n")

		-- Check if execution produced any output
		-- EMPTY OUTPUT IS OKAY - many valid commands just create objects without printing!

		if outputStr == "" then

			return true, "? Command executed successfully (no output generated)"

		else

			return true, outputStr

		end

	else

		return false, "[ERROR] Execution failed: " .. tostring(result)

	end

end


-- Main loop: Check for commands from Premium Plugin


RunService.Heartbeat:Connect(function()


	-- Check if Premium Plugin sent a command


	local executor = shared.BridgeExecutor


	if executor and executor.id and executor.code then


		-- Prevent re-executing same command


		if executor.id ~= lastExecutedId then


			lastExecutedId = executor.id


			print("\n" .. string.rep("=", 60))


			print("[?? Bridge] ?? Executing command ID: " .. executor.id)


			print("Code length: " .. #executor.code .. " chars")


			print(string.rep("=", 60))


			-- Execute code


			local success, output = executeCode(executor.code)


			if success then


				print("[?? Bridge] ? Execution successful")


			else


				print("[?? Bridge] ? Execution failed")


				print(output)


			end


			print(string.rep("=", 60) .. "\n")


			-- Write result back to shared storage


			shared.BridgeResult = {


				id = executor.id,


				success = success,


				output = output,


				timestamp = tick()


			}


			-- Clear executor to signal completion


			shared.BridgeExecutor = nil


		end


	end


end)


-- Heartbeat-Flag f�r Premium Plugin (einfacher und sicherer)
shared.MCPBridgeHeartbeat = 0
task.spawn(function()
	while true do
		shared.MCPBridgeHeartbeat = tick()
		task.wait(1)  -- Update jede Sekunde
	end
end)

print("? Bridge Plugin bereit!")
print(string.rep("=", 60) .. "\n")